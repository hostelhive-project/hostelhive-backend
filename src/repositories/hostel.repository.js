const Hostel = require('../models/Hostel');

function escapeRegex(text) {
  return String(text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

const publicHostelProjection =
  '-ownerAdminId -stripeAccountId -stripeOnboardingComplete -cleaningDirective -chatbotInfo.wifiPassword -chatbotInfo.emergencyContact -chatbotInfo.additionalInfo';

function buildSearchFilter({ q, location, maxPrice, facilities } = {}) {
  const filter = { publicationStatus: { $ne: 'Draft' } };
  if (location && typeof location === 'string' && location.trim()) {
    filter.location = new RegExp(escapeRegex(location.trim()), 'i');
  }
  if (q && typeof q === 'string' && q.trim()) {
    const expression = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [
      { name: expression },
      { location: expression },
      { 'propertyInfo.nearbyLandmarks': expression },
      { 'chatbotInfo.nearbyLandmarks': expression },
    ];
  }
  if (maxPrice !== undefined && maxPrice !== null && !Number.isNaN(Number(maxPrice))) {
    filter.priceTier = { $lte: Number(maxPrice) };
  }
  if (facilities) {
    const list = Array.isArray(facilities)
      ? facilities
      : String(facilities).split(',').map((item) => item.trim()).filter(Boolean);
    if (list.length) filter.facilities = { $all: list };
  }
  return filter;
}

const hostelRepository = {
  findById(id) {
    return Hostel.findById(id);
  },
  findPublicById(id) {
    return Hostel.findOne({ _id: id, publicationStatus: { $ne: 'Draft' } }).select(publicHostelProjection);
  },
  search({ location, maxPrice, facilities } = {}) {
    return Hostel.find(buildSearchFilter({ location, maxPrice, facilities }))
      .select(publicHostelProjection)
      .sort({ ratingAvg: -1 });
  },
  async searchExplore({ q, location, maxPrice, facilities, page, limit, sort }) {
    const filter = buildSearchFilter({ q, location, maxPrice, facilities });
    const sortOptions = {
      rating: { ratingAvg: -1, _id: 1 },
      'price-asc': { priceTier: 1, _id: 1 },
      'price-desc': { priceTier: -1, _id: 1 },
    };
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Hostel.find(filter)
        .select(publicHostelProjection)
        .sort(sortOptions[sort] || sortOptions.rating)
        .skip(offset)
        .limit(limit),
      Hostel.countDocuments(filter),
    ]);

    return {
      items,
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    };
  },
  updateById(id, updates) {
    return Hostel.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  },
};

module.exports = hostelRepository;
