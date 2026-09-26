/**
 * server.js
 * 
 * PHÂN HỆ: REST API SHARDING MIDDLEWARE (EXPRESS SERVER)
 * Cung cấp:
 *  1. Point Insert: POST /api/users
 *  2. Point Query: GET /api/users/:id
 *  3. Scatter-Gather Query: GET /api/users/search/by-email
 *  4. Healthcheck: GET /api/health
 */

require('dotenv').config();
const express = require('express');
const { ShardConnectionPoolManager } = require('./router');
const { idGenerator } = require('./snowflake');

const app = express();
app.use(express.json());

// ==============================================================================
// 1. CẤU HÌNH THÔNG SỐ CƠ SỞ DỮ LIỆU TỪ BIẾN MÔI TRƯỜNG
// Hỗ trợ 2 chế độ thử nghiệm:
//   - DB_MODE=SHARDED: Kết nối 3 Shard vật lý (Ports 3307, 3308, 3309)
//   - DB_MODE=MONOLITHIC: Kết nối 1 Database nguyên khối duy nhất (Port 3306)
// ==============================================================================
const DB_MODE = (process.env.DB_MODE || 'SHARDED').toUpperCase();

let SHARD_CONFIGS = [];

if (DB_MODE === 'MONOLITHIC') {
    // MÔI TRƯỜNG A: 1 Shard đại diện cho toàn bộ CSDL Monolithic (Pool Size 60)
    SHARD_CONFIGS = [
        {
            shardId: 0,
            host: process.env.MONOLITHIC_HOST || '127.0.0.1',
            port: parseInt(process.env.MONOLITHIC_PORT || '3306', 10),
            user: process.env.MONOLITHIC_USER || 'shard_user',
            password: process.env.MONOLITHIC_PASSWORD || 'shard_user_pass',
            database: process.env.MONOLITHIC_DATABASE || 'ecommerce_monolithic_db',
            connectionLimit: parseInt(process.env.MONOLITHIC_POOL_SIZE || '60', 10)
        }
    ];
} else {
    // MÔI TRƯỜNG B: Cụm 3 Shard phân tán (Mỗi shard Pool Size 20, tổng = 60)
    SHARD_CONFIGS = [
        {
            shardId: 0,
            host: process.env.SHARD0_HOST || '127.0.0.1',
            port: parseInt(process.env.SHARD0_PORT || '3307', 10),
            user: process.env.SHARD0_USER || 'shard_user',
            password: process.env.SHARD0_PASSWORD || 'shard_user_pass',
            database: process.env.SHARD0_DATABASE || 'ecommerce_db',
            connectionLimit: parseInt(process.env.SHARD0_POOL_SIZE || '20', 10)
        },
        {
            shardId: 1,
            host: process.env.SHARD1_HOST || '127.0.0.1',
            port: parseInt(process.env.SHARD1_PORT || '3308', 10),
            user: process.env.SHARD1_USER || 'shard_user',
            password: process.env.SHARD1_PASSWORD || 'shard_user_pass',
            database: process.env.SHARD1_DATABASE || 'ecommerce_db',
            connectionLimit: parseInt(process.env.SHARD1_POOL_SIZE || '20', 10)
        },
        {
            shardId: 2,
            host: process.env.SHARD2_HOST || '127.0.0.1',
            port: parseInt(process.env.SHARD2_PORT || '3309', 10),
            user: process.env.SHARD2_USER || 'shard_user',
            password: process.env.SHARD2_PASSWORD || 'shard_user_pass',
            database: process.env.SHARD2_DATABASE || 'ecommerce_db',
            connectionLimit: parseInt(process.env.SHARD2_POOL_SIZE || '20', 10)
        }
    ];
}

const poolManager = new ShardConnectionPoolManager(SHARD_CONFIGS);

// ==============================================================================
// 2. HEALTHCHECK API & CLUSTER STATUS
// ==============================================================================
app.get('/api/health', async (req, res) => {
    try {
        const shardStatus = await poolManager.healthCheck();
        const allUp = shardStatus.every(s => s.status === 'UP');
        return res.status(allUp ? 200 : 503).json({
            status: allUp ? 'HEALTHY' : 'DEGRADED',
            timestamp: new Date().toISOString(),
            shards: shardStatus
        });
    } catch (err) {
        return res.status(500).json({
            status: 'ERROR',
            error: err.message
        });
    }
});

// ==============================================================================
// 3. API GHI ĐIỂM (POINT INSERT): POST /api/users
// ==============================================================================
app.post('/api/users', async (req, res) => {
    const { username, email, full_name, password } = req.body;

    if (!username || !email) {
        return res.status(400).json({
            success: false,
            error: 'Trường username và email là bắt buộc.'
        });
    }

    try {
        // Bước 1: Sinh ID phân tán toàn cục 64-bit bằng Snowflake
        const userId = idGenerator.nextId();

        // Bước 2: Định tuyến băm CRC32(userId) mod N -> Tìm Shard đích
        const targetShard = poolManager.route(userId);
        const pool = poolManager.getPool(targetShard);

        // Bước 3: Ghi dữ liệu trực tiếp vào đúng Shard đích
        const sql = `
            INSERT INTO users (id, username, email, password_hash, full_name, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
        const dummyPasswordHash = password || 'hash_default_secret';

        await pool.execute(sql, [userId, username, email, dummyPasswordHash, full_name || null]);

        return res.status(201).json({
            success: true,
            message: 'Tạo người dùng thành công và định tuyến đúng phân mảnh.',
            data: {
                id: userId,
                username,
                email,
                full_name: full_name || null,
                target_shard: targetShard
            },
            meta: {
                routing_algorithm: 'CRC32_MODULO',
                shards_total: poolManager.shardCount
            }
        });
    } catch (error) {
        console.error('[POINT_INSERT_ERROR]', error);
        return res.status(500).json({
            success: false,
            error: 'Lỗi máy chủ khi ghi dữ liệu điểm vào shard.',
            details: error.message
        });
    }
});

// ==============================================================================
// 4. API ĐỌC ĐIỂM (POINT QUERY): GET /api/users/:id
// ==============================================================================
app.get('/api/users/:id', async (req, res) => {
    const userId = req.params.id;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Thiếu định danh user_id.'
        });
    }

    try {
        // Định tuyến O(1) trực tiếp đến Shard lưu trữ dữ liệu
        const targetShard = poolManager.route(userId);
        const pool = poolManager.getPool(targetShard);

        const sql = `
            SELECT id, username, email, full_name, created_at, updated_at
            FROM users
            WHERE id = ?
            LIMIT 1
        `;

        const [rows] = await pool.execute(sql, [userId]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Không tìm thấy user có ID = ${userId} trên Shard ${targetShard}.`
            });
        }

        return res.status(200).json({
            success: true,
            data: rows[0],
            meta: {
                located_shard: targetShard,
                routing_complexity: 'O(1)'
            }
        });
    } catch (error) {
        console.error(`[POINT_QUERY_ERROR] ID = ${userId}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Lỗi máy chủ khi đọc dữ liệu điểm từ shard.',
            details: error.message
        });
    }
});

// ==============================================================================
// 5. API TÌM KIẾM TOÀN CỤC (SCATTER-GATHER QUERY): GET /api/users/search/by-email
// ==============================================================================
app.get('/api/users/search/by-email', async (req, res) => {
    const targetEmail = req.query.email;

    if (!targetEmail) {
        return res.status(400).json({
            success: false,
            error: 'Tham số email (query param) là bắt buộc.'
        });
    }

    const hrStart = process.hrtime.bigint();

    try {
        const allPools = poolManager.getAllPools();
        const sql = `
            SELECT id, username, email, full_name, created_at
            FROM users
            WHERE email = ?
            LIMIT 1
        `;

        // BƯỚC 1: PARALLEL FAN-OUT (SCATTER) ĐỒNG THỜI TỚI TẤT CẢ N SHARD
        const shardPromises = allPools.map(async ({ shardId, pool }) => {
            const shardStart = process.hrtime.bigint();
            try {
                const [rows] = await pool.execute(sql, [targetEmail]);
                const shardEnd = process.hrtime.bigint();
                return {
                    shardId,
                    success: true,
                    rows,
                    durationMs: Number(shardEnd - shardStart) / 1e6
                };
            } catch (err) {
                const shardEnd = process.hrtime.bigint();
                return {
                    shardId,
                    success: false,
                    error: err.message,
                    durationMs: Number(shardEnd - shardStart) / 1e6
                };
            }
        });

        // BƯỚC 2: GATHER (THU NHẬN KẾT QUẢ TỪ TẤT CẢ CÁC PROMISE)
        const gatheredResults = await Promise.all(shardPromises);

        // BƯỚC 3: MERGE / REDUCE
        let foundRecord = null;
        let foundOnShard = null;
        const telemetry = [];

        for (const resItem of gatheredResults) {
            telemetry.push({
                shardId: resItem.shardId,
                status: resItem.success ? 'SUCCESS' : 'FAILED',
                latencyMs: parseFloat(resItem.durationMs.toFixed(3)),
                rowsMatched: resItem.success ? resItem.rows.length : 0
            });

            if (resItem.success && resItem.rows.length > 0 && !foundRecord) {
                foundRecord = resItem.rows[0];
                foundOnShard = resItem.shardId;
            }
        }

        const hrEnd = process.hrtime.bigint();
        const totalDurationMs = parseFloat((Number(hrEnd - hrStart) / 1e6).toFixed(3));

        if (!foundRecord) {
            return res.status(404).json({
                success: false,
                message: `Không tìm thấy tài khoản có email [${targetEmail}] trên bất kỳ shard nào.`,
                meta: {
                    pattern: 'PARALLEL_SCATTER_GATHER',
                    totalShardsQueried: allPools.length,
                    totalDurationMs,
                    telemetry
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: foundRecord,
            meta: {
                pattern: 'PARALLEL_SCATTER_GATHER',
                locatedShard: foundOnShard,
                totalShardsQueried: allPools.length,
                totalDurationMs,
                telemetry
            }
        });

    } catch (error) {
        console.error('[SCATTER_GATHER_ERROR]', error);
        return res.status(500).json({
            success: false,
            error: 'Lỗi thực thi Scatter-Gather xuyên phân mảnh.',
            details: error.message
        });
    }
});

// ==============================================================================
// 6. KHỞI CHẠY SERVER & XỬ LÝ GRACEFUL SHUTDOWN
// ==============================================================================
const PORT = process.env.PORT || 3000;

let server = null;
if (process.env.NODE_ENV !== 'test') {
    server = app.listen(PORT, () => {
        console.log(`[MIDDLEWARE] Sharding Proxy Server dang chay tai port ${PORT}`);
        console.log(`[MIDDLEWARE] So luong Shard duoc dinh tuyen: ${poolManager.shardCount}`);
        console.log(`[MIDDLEWARE] Datacenter ID: ${process.env.DATACENTER_ID || 1}, Worker ID: ${process.env.WORKER_ID || 1}`);
    });
}

const gracefulShutdown = async () => {
    console.log('\n[INFO] Nhan tin hieu tat server. Dang giai phong Connection Pools...');
    if (server) {
        server.close();
    }
    await poolManager.closeAll();
    console.log('[INFO] Da dong toan bo ket noi an toan.');
    process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = {
    app,
    poolManager
};
