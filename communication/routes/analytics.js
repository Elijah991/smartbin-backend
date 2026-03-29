const express = require('express');
const db = require('../../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

const KG_PER_FILL_POINT = 0.5;

/**
 * GET /api/analytics/summary
 * Admin-only aggregated analytics: daily cleared volume, per-zone collections,
 * top collectors, and lifetime estimated mass from fill_level_before.
 */
router.get(
    '/summary',
    authenticateToken,
    authorizeRole('admin'),
    async (req, res) => {
        try {
            const dailyQuery = `
                SELECT
                    DATE_TRUNC('day', c.collection_time)::date AS day,
                    COALESCE(SUM(c.fill_level_before), 0)::float8 AS total_fill_cleared
                FROM collections c
                WHERE c.collection_time >= NOW() - INTERVAL '7 days'
                GROUP BY DATE_TRUNC('day', c.collection_time)
                ORDER BY day ASC
            `;

            const zoneQuery = `
                SELECT
                    COALESCE(NULLIF(TRIM(b.zone), ''), 'Unassigned') AS zone,
                    COUNT(c.id)::int AS collection_count
                FROM collections c
                INNER JOIN bins b ON c.bin_id = b.id
                GROUP BY COALESCE(NULLIF(TRIM(b.zone), ''), 'Unassigned')
                ORDER BY collection_count DESC
            `;

            const leaderboardQuery = `
                SELECT
                    u.id AS user_id,
                    u.name AS name,
                    COUNT(c.id)::int AS collection_count
                FROM collections c
                INNER JOIN users u ON c.collector_id = u.id
                GROUP BY u.id, u.name
                ORDER BY collection_count DESC
                LIMIT 3
            `;

            const impactQuery = `
                SELECT COALESCE(SUM(fill_level_before), 0)::float8 AS lifetime_fill_sum
                FROM collections
            `;

            const avgFillQuery = `
                SELECT COALESCE(AVG(fill_level_before), 0)::float8 AS avg_fill_at_collection
                FROM collections
                WHERE fill_level_before IS NOT NULL
            `;

            const [dailyRes, zoneRes, boardRes, impactRes, avgFillRes] = await Promise.all([
                db.query(dailyQuery),
                db.query(zoneQuery),
                db.query(leaderboardQuery),
                db.query(impactQuery),
                db.query(avgFillQuery),
            ]);

            const dailyRows = Array.isArray(dailyRes.rows) ? dailyRes.rows : [];
            const zoneRows = Array.isArray(zoneRes.rows) ? zoneRes.rows : [];
            const boardRows = Array.isArray(boardRes.rows) ? boardRes.rows : [];
            const impactRow = impactRes.rows?.[0] || { lifetime_fill_sum: 0 };
            const avgFillRow = avgFillRes.rows?.[0] || { avg_fill_at_collection: 0 };

            const lifetimeFill = Number(impactRow.lifetime_fill_sum || 0);
            const estimatedKg = Math.round(lifetimeFill * KG_PER_FILL_POINT * 100) / 100;
            const avgFillAtCollection = Math.round(
                Number(avgFillRow.avg_fill_at_collection || 0) * 10
            ) / 10;

            const daily_volume = dailyRows.map((r) => ({
                date: r.day instanceof Date
                    ? r.day.toISOString().slice(0, 10)
                    : String(r.day).slice(0, 10),
                total_fill_cleared: Number(r.total_fill_cleared || 0),
            }));

            const zone_performance = zoneRows.map((r) => ({
                zone: r.zone,
                collection_count: Number(r.collection_count || 0),
            }));

            const collector_leaderboard = boardRows.map((r) => ({
                user_id: Number(r.user_id),
                name: r.name,
                collection_count: Number(r.collection_count || 0),
            }));

            res.json({
                success: true,
                data: {
                    daily_volume,
                    zone_performance,
                    collector_leaderboard,
                    total_impact: {
                        lifetime_fill_sum: lifetimeFill,
                        estimated_kg: estimatedKg,
                        kg_per_fill_point: KG_PER_FILL_POINT,
                        avg_fill_at_collection: avgFillAtCollection,
                    },
                },
            });
        } catch (error) {
            console.error('GET /analytics/summary error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
            });
        }
    }
);

module.exports = router;
