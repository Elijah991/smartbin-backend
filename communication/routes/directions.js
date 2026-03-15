const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function parseCoord(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// GET /api/directions?startLat=..&startLng=..&endLat=..&endLng=..
router.get('/', authenticateToken, async (req, res) => {
  try {
    const startLat = parseCoord(req.query.startLat);
    const startLng = parseCoord(req.query.startLng);
    const endLat = parseCoord(req.query.endLat);
    const endLng = parseCoord(req.query.endLng);

    if ([startLat, startLng, endLat, endLng].some((v) => v === null)) {
      return res.status(400).json({
        success: false,
        message: 'startLat, startLng, endLat, endLng are required numeric query params',
      });
    }

    const apiKey = process.env.ORS_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Directions service not configured (missing ORS_API_KEY)',
      });
    }

    // OpenRouteService Directions v2. Using POST avoids long query strings.
    const orsRes = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [startLng, startLat],
          [endLng, endLat],
        ],
      }),
    });

    const text = await orsRes.text();
    if (!orsRes.ok) {
      return res.status(orsRes.status).json({
        success: false,
        message: 'Directions provider error',
        details: text,
      });
    }

    // Return the provider response as JSON (GeoJSON FeatureCollection)
    const json = JSON.parse(text);
    return res.json({ success: true, data: json });
  } catch (error) {
    console.error('Directions error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

