const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../communication/middleware/auth');
const router = express.Router();

// Get dashboard statistics (Admin)
router.get('/admin', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        // Total bins
        const totalBinsResult = await db.query('SELECT COUNT(*) AS count FROM bins');
        const totalBinsRow = totalBinsResult.rows[0] || { count: 0 };
        
        // Critical bins
        const criticalBinsResult = await db.query(
            "SELECT COUNT(*) AS count FROM bins WHERE status = 'critical'"
        );
        const criticalBinsRow = criticalBinsResult.rows[0] || { count: 0 };
        
        // Warning bins
        const warningBinsResult = await db.query(
            "SELECT COUNT(*) AS count FROM bins WHERE status = 'warning'"
        );
        const warningBinsRow = warningBinsResult.rows[0] || { count: 0 };
        
        // Total collectors
        const totalCollectorsResult = await db.query(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'collector'"
        );
        const totalCollectorsRow = totalCollectorsResult.rows[0] || { count: 0 };
        
        // Active collectors
        const activeCollectorsResult = await db.query(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'collector' AND status = 'active'"
        );
        const activeCollectorsRow = activeCollectorsResult.rows[0] || { count: 0 };
        
        // Today's collections
        const todayCollectionsResult = await db.query(
            'SELECT COUNT(*) AS count FROM collections WHERE collection_time::date = CURRENT_DATE'
        );
        const todayCollectionsRow = todayCollectionsResult.rows[0] || { count: 0 };
        
        // This week's collections
        const weekCollectionsResult = await db.query(
            "SELECT COUNT(*) AS count FROM collections WHERE date_trunc('week', collection_time) = date_trunc('week', NOW())"
        );
        const weekCollectionsRow = weekCollectionsResult.rows[0] || { count: 0 };
        
        // Average fill level
        const avgFillLevelResult = await db.query(
            'SELECT AVG(fill_level) AS avg_level FROM bins'
        );
        const avgFillLevelRow = avgFillLevelResult.rows[0] || { avg_level: 0 };

        // Collections per day (last 7 days)
        const dailyCollectionsResult = await db.query(`
            SELECT DATE(collection_time) AS date, COUNT(*) AS count
            FROM collections
            WHERE collection_time >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(collection_time)
            ORDER BY date ASC
        `);
        const dailyCollections = Array.isArray(dailyCollectionsResult.rows)
            ? dailyCollectionsResult.rows
            : [];

        // Top collectors (this month)
        const topCollectorsResult = await db.query(`
            SELECT u.name, u.id, COUNT(c.id) AS collections
            FROM users u
            JOIN collections c ON u.id = c.collector_id
            WHERE date_trunc('month', c.collection_time) = date_trunc('month', NOW())
            GROUP BY u.id
            ORDER BY collections DESC
            LIMIT 5
        `);
        const topCollectors = Array.isArray(topCollectorsResult.rows)
            ? topCollectorsResult.rows
            : [];

        // Bins by status
        const binsByStatusResult = await db.query(`
            SELECT status, COUNT(*) AS count
            FROM bins
            GROUP BY status
        `);
        const binsByStatus = Array.isArray(binsByStatusResult.rows)
            ? binsByStatusResult.rows
            : [];

        const overviewObj = {
            total_bins: Number(totalBinsRow.count || 0),
            critical_bins: Number(criticalBinsRow.count || 0),
            warning_bins: Number(warningBinsRow.count || 0),
            total_collectors: Number(totalCollectorsRow.count || 0),
            active_collectors: Number(activeCollectorsRow.count || 0),
            today_collections: Number(todayCollectionsRow.count || 0),
            week_collections: Number(weekCollectionsRow.count || 0),
            avg_fill_level: Math.round(Number(avgFillLevelRow.avg_level || 0))
        };

        res.status(200).json({
            success: true,
            data: {
                // Top-level stats for clients expecting direct keys
                ...overviewObj,
                // Keep overview for backward compatibility
                overview: overviewObj,
                daily_collections: dailyCollections,
                top_collectors: topCollectors,
                bins_by_status: binsByStatus
            }
        });

    } catch (error) {
        console.error('Get admin dashboard error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get collector dashboard
router.get('/collector', authenticateToken, async (req, res) => {
    try {
        const collectorId = req.user.id;

        // Assigned bins
        const assignedBinsQuery =
            'SELECT COUNT(*) AS count FROM bins WHERE assigned_to = $1';
        console.log('Collector dashboard assignedBins query:', assignedBinsQuery, 'params:', [collectorId]);
        const assignedBinsResult = await db.query(assignedBinsQuery, [collectorId]);
        const assignedBinsRow = assignedBinsResult.rows[0] || { count: 0 };

        // Critical bins assigned
        const criticalBinsQuery =
            "SELECT COUNT(*) AS count FROM bins WHERE assigned_to = $1 AND status = 'critical'";
        console.log('Collector dashboard criticalBins query:', criticalBinsQuery, 'params:', [collectorId]);
        const criticalBinsResult = await db.query(criticalBinsQuery, [collectorId]);
        const criticalBinsRow = criticalBinsResult.rows[0] || { count: 0 };

        // Warning bins assigned
        const warningBinsQuery =
            "SELECT COUNT(*) AS count FROM bins WHERE assigned_to = $1 AND status = 'warning'";
        console.log('Collector dashboard warningBins query:', warningBinsQuery, 'params:', [collectorId]);
        const warningBinsResult = await db.query(warningBinsQuery, [collectorId]);
        const warningBinsRow = warningBinsResult.rows[0] || { count: 0 };

        // Today's collections
        const todayCollectionsQuery = `
            SELECT COUNT(*) AS count FROM collections 
            WHERE collector_id = $1
              AND collection_time::date = CURRENT_DATE
        `;
        console.log('Collector dashboard todayCollections query:', todayCollectionsQuery.trim(), 'params:', [collectorId]);
        const todayCollectionsResult = await db.query(todayCollectionsQuery, [collectorId]);
        const todayCollectionsRow = todayCollectionsResult.rows[0] || { count: 0 };

        // This week's collections
        const weekCollectionsQuery = `
            SELECT COUNT(*) AS count FROM collections 
            WHERE collector_id = $1
              AND date_trunc('week', collection_time) = date_trunc('week', NOW())
        `;
        console.log('Collector dashboard weekCollections query:', weekCollectionsQuery.trim(), 'params:', [collectorId]);
        const weekCollectionsResult = await db.query(weekCollectionsQuery, [collectorId]);
        const weekCollectionsRow = weekCollectionsResult.rows[0] || { count: 0 };

        // Total collections
        const totalCollectionsQuery =
            'SELECT COUNT(*) AS count FROM collections WHERE collector_id = $1';
        console.log('Collector dashboard totalCollections query:', totalCollectionsQuery, 'params:', [collectorId]);
        const totalCollectionsResult = await db.query(totalCollectionsQuery, [collectorId]);
        const totalCollectionsRow = totalCollectionsResult.rows[0] || { count: 0 };

        // Recent collections
        const recentCollectionsQuery = `
            SELECT c.*, b.bin_code, b.location
            FROM collections c
            JOIN bins b ON c.bin_id = b.id
            WHERE c.collector_id = $1
            ORDER BY c.collection_time DESC
            LIMIT 10
        `;
        console.log('Collector dashboard recentCollections query:', recentCollectionsQuery.trim(), 'params:', [collectorId]);
        const recentCollectionsResult = await db.query(recentCollectionsQuery, [collectorId]);
        const recentCollections = Array.isArray(recentCollectionsResult.rows)
            ? recentCollectionsResult.rows
            : [];

        // Pending bins (critical and warning)
        const pendingBinsQuery = `
            SELECT * FROM bins 
            WHERE assigned_to = $1
              AND (status = 'critical' OR status = 'warning')
            ORDER BY fill_level DESC
        `;
        console.log('Collector dashboard pendingBins query:', pendingBinsQuery.trim(), 'params:', [collectorId]);
        const pendingBinsResult = await db.query(pendingBinsQuery, [collectorId]);
        const pendingBins = Array.isArray(pendingBinsResult.rows)
            ? pendingBinsResult.rows
            : [];

        res.json({
            success: true,
            data: {
                overview: {
                    assigned_bins: Number(assignedBinsRow.count || 0),
                    critical_bins: Number(criticalBinsRow.count || 0),
                    warning_bins: Number(warningBinsRow.count || 0),
                    today_collections: Number(todayCollectionsRow.count || 0),
                    week_collections: Number(weekCollectionsRow.count || 0),
                    total_collections: Number(totalCollectionsRow.count || 0)
                },
                recent_collections: recentCollections,
                pending_bins: pendingBins
            }
        });

    } catch (error) {
        console.error('Get collector dashboard error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get analytics data (Admin only)
router.get('/analytics', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { period = '30' } = req.query; // days
        const days = Number.parseInt(period, 10) || 30;

        // Collection trends
        const collectionTrendsQuery = `
            SELECT DATE(collection_time) AS date, COUNT(*) AS count
            FROM collections
            WHERE collection_time >= NOW() - ($1::int * INTERVAL '1 day')
            GROUP BY date
            ORDER BY date ASC
        `;
        console.log('Analytics collectionTrends query:', collectionTrendsQuery.trim(), 'params:', [days]);
        const collectionTrendsResult = await db.query(collectionTrendsQuery, [days]);
        const collectionTrends = Array.isArray(collectionTrendsResult.rows)
            ? collectionTrendsResult.rows
            : [];

        // Fill level distribution
        const fillLevelDistQuery = `
            SELECT 
                CASE 
                    WHEN fill_level < 20 THEN '0-20%'
                    WHEN fill_level < 40 THEN '20-40%'
                    WHEN fill_level < 60 THEN '40-60%'
                    WHEN fill_level < 80 THEN '60-80%'
                    ELSE '80-100%'
                END AS range,
                COUNT(*) AS count
            FROM bins
            GROUP BY range
            ORDER BY range
        `;
        console.log('Analytics fillLevelDist query:', fillLevelDistQuery.trim());
        const fillLevelDistResult = await db.query(fillLevelDistQuery);
        const fillLevelDist = Array.isArray(fillLevelDistResult.rows)
            ? fillLevelDistResult.rows
            : [];

        // Collector performance
        const collectorPerfQuery = `
            SELECT u.name, u.id,
                   COUNT(c.id) AS total_collections,
                   COUNT(DISTINCT b.id) AS bins_assigned,
                   AVG(c.fill_level_before) AS avg_fill_collected
            FROM users u
            LEFT JOIN collections c ON u.id = c.collector_id 
                AND c.collection_time >= NOW() - ($1::int * INTERVAL '1 day')
            LEFT JOIN bins b ON u.id = b.assigned_to
            WHERE u.role = 'collector'
            GROUP BY u.id, u.name
            ORDER BY total_collections DESC
        `;
        console.log('Analytics collectorPerf query:', collectorPerfQuery.trim(), 'params:', [days]);
        const collectorPerfResult = await db.query(collectorPerfQuery, [days]);
        const collectorPerf = Array.isArray(collectorPerfResult.rows)
            ? collectorPerfResult.rows
            : [];

        // Average collection frequency
        const avgFrequencyQuery = `
            SELECT AVG(collection_frequency) AS avg_days
            FROM (
                SELECT bin_id, 
                       AVG(
                           EXTRACT(EPOCH FROM (next_collection_time - collection_time)) 
                           / 3600.0
                       ) / 24 AS collection_frequency
                FROM (
                    SELECT bin_id,
                           collection_time,
                           LEAD(collection_time) OVER (
                               PARTITION BY bin_id 
                               ORDER BY collection_time
                           ) AS next_collection_time
                    FROM collections
                    WHERE collection_time >= NOW() - ($1::int * INTERVAL '1 day')
                ) AS t
                WHERE next_collection_time IS NOT NULL
                GROUP BY bin_id
            ) AS frequencies
        `;
        console.log('Analytics avgFrequency query:', avgFrequencyQuery.trim(), 'params:', [days]);
        const avgFrequencyResult = await db.query(avgFrequencyQuery, [days]);
        const avgFrequencyRow = avgFrequencyResult.rows[0] || { avg_days: 0 };

        res.json({
            success: true,
            data: {
                collection_trends: collectionTrends,
                fill_level_distribution: fillLevelDist,
                collector_performance: collectorPerf,
                avg_collection_frequency_days: Number(avgFrequencyRow.avg_days || 0)
            }
        });

    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;