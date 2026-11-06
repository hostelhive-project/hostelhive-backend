const { v4: uuidv4 } = require('uuid');
const AppError = require('../utils/AppError');
const chatMessageRepository = require('../repositories/chatMessage.repository');
const { chatCompletion } = require('../integrations/groq');
const { Booking: Booking } = require('../repositories/data.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Hostel: Hostel } = require('../repositories/data.repository');
const hostelRepository = require('../repositories/hostel.repository');

const { ChatMessage: ChatMessage } = require('../repositories/data.repository');

const MAX_HISTORY_MESSAGES = 20; // context window management — see AGENTS.md

/**
 * Resolves context for a chat message.
 * - Resident Mode: If the user has an active 'CheckedIn' booking and either did not
 *   specify a hostelId or specified their own resident hostelId, they are treated as
 *   a verified resident (with access to private facts like WiFi).
 * - Seeker Mode: If the user specified a hostelId (whether they have a booking elsewhere or not),
 *   and it does not match their CheckedIn resident hostel, the requested hostel is loaded
 *   and treated as a seeker (isResident: false, public facts only).
 * - Fallback Mode: If no active booking and no hostelId requested, returns generic assistant context.
 */
async function resolveChatContext(userId, requestedHostelId) {
  const booking = await Booking.findOne({
    studentId: userId,
    status: 'CheckedIn',
  }).sort({ createdAt: -1 });

  let residentHostel = null;
  if (booking) {
    const room = await Room.findById(booking.roomId);
    if (room?.hostelId) {
      residentHostel = await Hostel.findById(room.hostelId);
    }
  }

  // Resident asking about their own hostel (or default hostel without specifying hostelId)
  if (residentHostel) {
    if (!requestedHostelId || residentHostel._id.toString() === requestedHostelId.toString()) {
      return { hostel: residentHostel, isResident: true };
    }
  }

  // Seeker asking about a specific hostel (or resident browsing a different hostel)
  if (requestedHostelId) {
    const requestedHostel = await hostelRepository.findPublicById(requestedHostelId);
    if (requestedHostel) {
      return { hostel: requestedHostel, isResident: false };
    }
  }

  return { hostel: null, isResident: false };
}

/**
 * Builds the system prompt that grounds the AI in this hostel's facts.
 * - For prospective seekers: sanitized public facts only (check-in/out, rules, contact, landmarks, rent).
 *   Private fields (WiFi password, emergency internal contacts, private notes) are strictly withheld.
 * - For checked-in residents: full resident facts including WiFi.
 */
function buildSystemPrompt(hostel, isResident = false) {
  if (!hostel) {
    return [
      "You are HostelHive's assistant, speaking to a student who does not yet have an active hostel booking.",
      'You have no specific hostel information available for them.',
      'Answer general questions about using HostelHive politely and briefly.',
      'For anything specific to a particular hostel (WiFi, rules, timings), tell them to check the hostel details page or book first.',
    ].join(' ');
  }

  const prop = hostel.propertyInfo || {};
  const chat = hostel.chatbotInfo || {};

  const gateOpenTime = prop.gateOpenTime || '';
  const gateCloseTime = prop.gateCloseTime || '';
  const houseRules = prop.houseRules?.length ? prop.houseRules : (chat.rules || []);
  const receptionContact = prop.receptionContact || chat.contactNumber || '';
  const nearbyLandmarks = prop.nearbyLandmarks || chat.nearbyLandmarks || '';

  const propertySection = [
    `Hostel name: ${hostel.name}`,
    `Location: ${hostel.location}`,
    hostel.priceTier ? `Price tier / Rent: ${hostel.priceTier} PKR` : null,
    hostel.facilities?.length ? `Facilities: ${hostel.facilities.join(', ')}` : null,
    gateOpenTime ? `Gate opening time: ${gateOpenTime}` : null,
    gateCloseTime ? `Gate closing time: ${gateCloseTime}` : null,
    houseRules?.length ? `House rules:\n${houseRules.map((r) => `- ${r}`).join('\n')}` : null,
    receptionContact ? `Reception contact: ${receptionContact}` : null,
    nearbyLandmarks ? `Nearby landmarks: ${nearbyLandmarks}` : null,
  ].filter(Boolean).join('\n');

  if (!isResident) {
    return [
      `You are HostelHive's helpful assistant answering questions from a prospective student inquiring about ${hostel.name}.`,
      "Answer naturally, warmly, and accurately using only the public facts provided below.",
      "IMPORTANT PRIVACY RULE: Wi-Fi credentials, emergency internal contacts, and private resident access details are strictly reserved for checked-in residents and are not available to prospective students. If asked about Wi-Fi passwords, explain politely that Wi-Fi access details are provided upon check-in.",
      "If the student asks something not covered by these facts (e.g. availability of specific room numbers, personal account status, or unlisted policies), advise them to check the hostel details in the app or contact the hostel admin directly. Do not guess or hallucinate any details.",
      '',
      '--- PROPERTY INFORMATION ---',
      propertySection || '(The hostel admin has not published additional details yet.)',
    ].join('\n');
  }

  const residentSections = [
    '--- PROPERTY INFORMATION ---',
    propertySection || '(The hostel admin has not filled in property details yet.)',
  ];

  if (chat.additionalInfo) {
    residentSections.push('', '--- ADDITIONAL CHATBOT KNOWLEDGE ---', chat.additionalInfo);
  }

  const privateFacts = [
    chat.wifiPassword ? `Wi-Fi password: ${chat.wifiPassword}` : null,
    chat.emergencyContact ? `Emergency contact: ${chat.emergencyContact}` : null,
  ].filter(Boolean);

  if (privateFacts.length > 0) {
    residentSections.push('', '--- PRIVATE RESIDENT INFORMATION ---', privateFacts.join('\n'));
  }

  return [
    "You are HostelHive's friendly assistant, speaking directly to a resident of the hostel described below.",
    "Answer naturally and conversationally, like a helpful human staff member would — not like you're reading from a form.",
    "Only use the facts given below. If the resident asks something not covered by these facts (e.g. their rent balance, a specific complaint status, anything personal to their account), tell them you don't have that information and suggest they check the app or contact the hostel admin directly. Do not guess or make up details.",
    '',
    ...residentSections,
  ].join('\n');
}

const chatbotService = {
  /**
   * Sends one user message, returns the AI's reply, and persists both sides
   * to ChatMessage under the given (or newly created) sessionId.
   */
  async sendMessage(userId, { message, sessionId, hostelId }) {
    const cleanSessionId = sessionId && typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
    const cleanHostelId = hostelId && typeof hostelId === 'string' && hostelId.trim() ? hostelId.trim() : null;

    let activeSessionId = cleanSessionId || uuidv4();

    // Prevent cross-hostel contamination if a sessionId is reused across different hostels
    if (cleanSessionId && cleanHostelId) {
      const priorMessage = await ChatMessage.findOne({ userId, sessionId: cleanSessionId }).select('hostelId');
      if (priorMessage?.hostelId && priorMessage.hostelId.toString() !== cleanHostelId.toString()) {
        activeSessionId = uuidv4();
      }
    }

    const { hostel, isResident } = await resolveChatContext(userId, cleanHostelId);
    const systemPrompt = buildSystemPrompt(hostel, isResident);

    const history = await chatMessageRepository.findRecentForSession(userId, activeSessionId, MAX_HISTORY_MESSAGES);

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.sender === 'User' ? 'user' : 'assistant', content: m.message })),
      { role: 'user', content: message },
    ];

    const messageHostelId = hostel?._id || null;

    // Save the user's message first so it's not lost if the AI call fails.
    await chatMessageRepository.create({
      userId,
      sessionId: activeSessionId,
      hostelId: messageHostelId,
      sender: 'User',
      message,
    });

    let reply;
    try {
      reply = await chatCompletion(apiMessages);
    } catch (err) {
      console.error('[chatbot] Provider request failed:', err.message);
      throw new AppError('The chatbot is temporarily unavailable. Please try again shortly.', 502);
    }

    if (!reply) {
      reply = "Sorry, I couldn't come up with an answer to that — could you try rephrasing?";
    }

    await chatMessageRepository.create({
      userId,
      sessionId: activeSessionId,
      hostelId: messageHostelId,
      sender: 'Bot',
      message: reply,
    });

    return { sessionId: activeSessionId, reply };
  },

  async getHistory(userId, sessionId) {
    if (!sessionId) throw new AppError('sessionId is required', 400);
    return chatMessageRepository.findRecentForSession(userId, sessionId, 100);
  },

  listSessions(userId) {
    return chatMessageRepository.findSessionsForUser(userId);
  },
};

module.exports = chatbotService;
