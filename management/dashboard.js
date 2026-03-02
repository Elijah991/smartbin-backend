const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../communication/middleware/auth');
const router = express.Router();

// Get dashboard statistics (Admin)
router.get('/admin', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        // Total bins
        const [totalBins] = await db.query('SELECT COUNT(*) as count FROM bins');
        
        // Critical bins
        const [criticalBins] = await db.query(
            'SELECT COUNT(*) as count FROM bins WHERE status = "critical"'
        );
        
        // Warning bins
        const [warningBins] = await db.query(
            'SELECT COUNT(*) as count FROM bins WHERE status = "warning"'
        );
        
        // Total collectors
        const [totalCollectors] = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE role = "collector"'
        );
        
        // Active collectors
        const [activeCollectors] = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE role = "collector" AND status = "active"'
        );
        
        // Today's collections
        const [todayCollections] = await db.query(
            'SELECT COUNT(*) as count FROM collections WHERE DATE(collection_time) = CURDATE()'
        );
        
        // This week's collections
        const [weekCollections] = await db.query(
            'SELECT COUNT(*) as count FROM collections WHERE YEARWEEK(collection_time) = YEARWEEK(NOW())'
        );
        
        // Average fill level
        const [avgFillLevel] = await db.query(
            'SELECT AVG(fill_level) as avg_level FROM bins'
        );

        // Collections per day (last 7 days)
        const [dailyCollections] = await db.query(`
            SELECT DATE(collection_time) as date, COUNT(*) as count
            FROM collections
            WHERE collection_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(collection_time)
            ORDER BY date ASC
        `);

        // Top collectors (this month)
        const [topCollectors] = await db.query(`
            SELECT u.name, u.id, COUNT(c.id) as collections
            FROM users u
            JOIN collections c ON u.id = c.collector_id
            WHERE MONTH(c.collection_time) = MONTH(NOW())
            AND YEAR(c.collection_time) = YEAR(NOW())
            GROUP BY u.id
            ORDER BY collections DESC
            LIMIT 5
        `);

        // Bins by status
        const [binsByStatus] = await db.query(`
            SELECT status, COUNT(*) as count
            FROM bins
            GROUP BY status
        `);

        const overviewObj = {
            total_bins: totalBins[0].count,
            critical_bins: criticalBins[0].count,
            warning_bins: warningBins[0].count,
            total_collectors: totalCollectors[0].count,
            active_collectors: activeCollectors[0].count,
            today_collections: todayCollections[0].count,
            week_collections: weekCollections[0].count,
            avg_fill_level: Math.round(avgFillLevel[0].avg_level || 0)
        };

        res.json({
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
        const [assignedBins] = await db.query(
            'SELECT COUNT(*) as count FROM bins WHERE assigned_to = ?',
            [collectorId]
        );

        // Critical bins assigned
        const [criticalBins] = await db.query(
            'SELECT COUNT(*) as count FROM bins WHERE assigned_to = ? AND status = "critical"',
            [collectorId]
        );

        // Warning bins assigned
        const [warningBins] = await db.query(
            'SELECT COUNT(*) as count FROM bins WHERE assigned_to = ? AND status = "warning"',
            [collectorId]
        );

        // Today's collections
        const [todayCollections] = await db.query(
            `SELECT COUNT(*) as count FROM collections 
             WHERE collector_id = ? AND DATE(collection_time) = CURDATE()`,
            [collectorId]
        );

        // This week's collections
        const [weekCollections] = await db.query(
            `SELECT COUNT(*) as count FROM collections 
             WHERE collector_id = ? AND YEARWEEK(collection_time) = YEARWEEK(NOW())`,
            [collectorId]
        );

        // Total collections
        const [totalCollections] = await db.query(
            'SELECT COUNT(*) as count FROM collections WHERE collector_id = ?',
            [collectorId]
        );

        // Recent collections
        const [recentCollections] = await db.query(
            `SELECT c.*, b.bin_code, b.location
             FROM collections c
             JOIN bins b ON c.bin_id = b.id
             WHERE c.collector_id = ?
             ORDER BY c.collection_time DESC
             LIMIT 10`,
            [collectorId]
        );

        // Pending bins (critical and warning)
        const [pendingBins] = await db.query(
            `SELECT * FROM bins 
             WHERE assigned_to = ? AND (status = 'critical' OR status = 'warning')
             ORDER BY fill_level DESC`,
            [collectorId]
        );

        res.json({
            success: true,
            data: {
                overview: {
                    assigned_bins: assignedBins[0].count,
                    critical_bins: criticalBins[0].count,
                    warning_bins: warningBins[0].count,
                    today_collections: todayCollections[0].count,
                    week_collections: weekCollections[0].count,
                    total_collections: totalCollections[0].count
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

        // Collection trends
        const [collectionTrends] = await db.query(`
            SELECT DATE(collection_time) as date, COUNT(*) as count
            FROM collections
            WHERE collection_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(collection_time)
            ORDER BY date ASC
        `, [parseInt(period)]);

        // Fill level distribution
        const [fillLevelDist] = await db.query(`
            SELECT 
                CASE 
                    WHEN fill_level < 20 THEN '0-20%'
                    WHEN fill_level < 40 THEN '20-40%'
                    WHEN fill_level < 60 THEN '40-60%'
                    WHEN fill_level < 80 THEN '60-80%'
                    ELSE '80-100%'
                END as range,
                COUNT(*) as count
            FROM bins
            GROUP BY range
            ORDER BY range
        `);

        // Collector performance
        const [collectorPerf] = await db.query(`
            SELECT u.name, u.id,
                   COUNT(c.id) as total_collections,
                   COUNT(DISTINCT b.id) as bins_assigned,
                   AVG(c.fill_level_before) as avg_fill_collected
            FROM users u
            LEFT JOIN collections c ON u.id = c.collector_id 
                AND c.collection_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
            LEFT JOIN bins b ON u.id = b.assigned_to
            WHERE u.role = 'collector'
            GROUP BY u.id
            ORDER BY total_collections DESC
        `, [parseInt(period)]);

        // Average collection frequency
        const [avgFrequency] = await db.query(`
            SELECT AVG(collection_frequency) as avg_days
            FROM (
                SELECT bin_id, 
                       AVG(TIMESTAMPDIFF(HOUR, collection_time, 
                           LEAD(collection_time) OVER (PARTITION BY bin_id ORDER BY collection_time)
                       )) / 24 as collection_frequency
                FROM collections
                WHERE collection_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY bin_id
            ) as frequencies
        `, [parseInt(period)]);

        res.json({
            success: true,
            data: {
                collection_trends: collectionTrends,
                fill_level_distribution: fillLevelDist,
                collector_performance: collectorPerf,
                avg_collection_frequency_days: avgFrequency[0].avg_days || 0
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