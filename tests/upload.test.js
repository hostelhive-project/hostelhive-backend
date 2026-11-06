process.env.NODE_ENV = 'test';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const env = require('../src/config/env');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Hostel = require('../src/models/Hostel');

describe('Image Upload and Hostel Banner Management Suite', () => {
  let adminToken = null;
  let testAdmin = null;

  beforeAll(async () => {
    await connectDB();

    testAdmin = await User.create({
      name: 'Upload Test Admin',
      email: `uploadadmin_${Date.now()}@hostelhive.pk`,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
      role: 'Admin',
      phone: '+92 (300) 123-4567',
    });

    adminToken = jwt.sign(
      { sub: testAdmin._id.toString(), role: testAdmin.role },
      env.jwt.secret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    if (testAdmin) {
      await User.deleteOne({ _id: testAdmin._id });
    }
    await mongoose.connection.close();
  });

  describe('1. Upload Endpoint Security & Validation', () => {
    test('POST /api/upload/image without auth token returns 401', async () => {
      const res = await request(app).post('/api/upload/image');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/upload/image with auth but no file returns 400', async () => {
      const res = await request(app)
        .post('/api/upload/image')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Please select an image file/i);
    });

    test('POST /api/upload/image rejects non-image file formats (e.g. .txt)', async () => {
      const res = await request(app)
        .post('/api/upload/image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('hello world plain text'), 'document.txt');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/This image format is not supported/i);
    });

    test('POST /api/upload/image successfully uploads a valid JPEG/PNG and returns ImageKit URL', async () => {
      // 1x1 transparent JPEG/PNG pixel buffer
      const dummyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post('/api/upload/image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', dummyPng, 'test-banner.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBeDefined();
      expect(res.body.data.url).toMatch(/^https:\/\/ik\.imagekit\.io\//);
      expect(res.body.data.fileId).toBeDefined();
    });

    test('POST /api/upload/images uploads multiple gallery images to ImageKit', async () => {
      const dummyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post('/api/upload/images')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('images', dummyPng, 'gallery-1.png')
        .attach('images', dummyPng, 'gallery-2.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.urls)).toBe(true);
      expect(res.body.data.urls.length).toBe(2);
      expect(res.body.data.urls[0]).toMatch(/^https:\/\/ik\.imagekit\.io\//);
      expect(res.body.data.urls[1]).toMatch(/^https:\/\/ik\.imagekit\.io\//);
      expect(Array.isArray(res.body.data.files)).toBe(true);
      expect(res.body.data.files.length).toBe(2);
    });
  });

  describe('2. Hostel Model & Controller bannerImage / images Persistence', () => {
    test('POST /api/hostels saves bannerImage separately from gallery images[]', async () => {
      const uniqueName = `Media Test Hostel ${Date.now()}`;
      const bannerUrl = 'https://images.unsplash.com/photo-banner-12345';
      const galleryUrls = [
        'https://images.unsplash.com/photo-gallery-1',
        'https://images.unsplash.com/photo-gallery-2',
        'https://images.unsplash.com/photo-gallery-3',
      ];

      const res = await request(app)
        .post('/api/hostels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: uniqueName,
          location: 'Lahore (Near UCP)',
          priceTier: 15000,
          facilities: ['Wi-Fi', 'AC'],
          bannerImage: bannerUrl,
          images: galleryUrls,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bannerImage).toBe(bannerUrl);
      expect(res.body.data.images).toEqual(galleryUrls);

      // Verify in DB directly: bannerImage must NOT be inside images[]
      const dbHostel = await Hostel.findById(res.body.data._id);
      expect(dbHostel.bannerImage).toBe(bannerUrl);
      expect(dbHostel.images).toEqual(galleryUrls);
      expect(dbHostel.images).not.toContain(bannerUrl);

      // Clean up
      await Hostel.deleteOne({ _id: dbHostel._id });
    });

    test('PUT /api/hostels/:id updates bannerImage and gallery images separately', async () => {
      // Create a test hostel first
      const hostel = await Hostel.create({
        name: `Update Media Hostel ${Date.now()}`,
        location: 'Islamabad F-7',
        priceTier: 18000,
        ownerAdminId: testAdmin._id,
        bannerImage: 'https://images.unsplash.com/initial-banner',
        images: ['https://images.unsplash.com/initial-img1'],
      });

      const newBannerUrl = 'https://images.unsplash.com/new-banner-456';
      const newImages = [
        'https://images.unsplash.com/new-gallery-1',
        'https://images.unsplash.com/new-gallery-2',
      ];

      const res = await request(app)
        .put(`/api/hostels/${hostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bannerImage: newBannerUrl,
          images: newImages,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.bannerImage).toBe(newBannerUrl);
      expect(res.body.data.images).toEqual(newImages);
      expect(res.body.data.images).not.toContain(newBannerUrl);

      // Clean up
      await Hostel.deleteOne({ _id: hostel._id });
    });
  });
});

