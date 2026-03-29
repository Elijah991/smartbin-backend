const express = require('express');
const db = require('../../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/collections?limit=10
 * Recent collections across all bins (admin only). Ordered by collection_time DESC.
 */
router.get(
    '/',
    authenticateToken,
    authorizeRole('admin'),
    async (req, res) => {
        try {
            const rawLimit = parseInt(req.query.limit, 10);
            const limit = Number.isFinite(rawLimit)
                ? Math.min(Math.max(rawLimit, 1), 100)
                : 10;

            const q = `
                SELECT
                    c.id,
                    c.bin_id,
                    c.collector_id,
                    c.fill_level_before,
                    c.fill_level_after,
                    c.collection_time,
                    c.notes,
                    b.bin_code,
                    b.location AS location_name,
                    u.name AS collector_name
                FROM collections c
                INNER JOIN bins b ON c.bin_id = b.id
                INNER JOIN users u ON c.collector_id = u.id
                ORDER BY c.collection_time DESC
                LIMIT $1
            `;
            const result = await db.query(q, [limit]);
            const rows = Array.isArray(result.rows) ? result.rows : [];

            res.json({
                success: true,
                data: rows,
            });
        } catch (error) {
            console.error('GET /collections error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
            });
        }
    }
);

/**
 * GET /api/collections/my-history
 * All collection rows for the authenticated collector, with bin code and location.
 */
router.get(
    '/my-history',
    authenticateToken,
    authorizeRole('collector'),
    async (req, res) => {
        try {
            const historyQuery = `
                SELECT
                    c.id,
                    c.bin_id,
                    c.collector_id,
                    c.fill_level_before,
                    c.fill_level_after,
                    c.collection_time,
                    c.notes,
                    b.bin_code,
                    b.location AS location_name
                FROM collections c
                INNER JOIN bins b ON c.bin_id = b.id
                WHERE c.collector_id = $1
                ORDER BY c.collection_time DESC
                LIMIT 200
            `;
            const result = await db.query(historyQuery, [req.user.id]);
            const rows = Array.isArray(result.rows) ? result.rows : [];

            res.json({
                success: true,
                data: rows,
            });
        } catch (error) {
            console.error('GET /collections/my-history error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
            });
        }
    }
);

module.exports = router;
