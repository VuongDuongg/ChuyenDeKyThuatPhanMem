/**
 * router.js
 * 
 * PHÂN HỆ: QUẢN LÝ CONNECTION POOL ĐỘC LẬP & BỘ ĐỊNH TUYẾN CRC32 MODULO N
 */

const mysql = require('mysql2/promise');
const zlib = require('zlib');

class ShardConnectionPoolManager {
    /**
     * @param {Array<object>} shardConfigs - Danh sách thông số cấu hình kết nối các shard
     */
    constructor(shardConfigs) {
        if (!Array.isArray(shardConfigs) || shardConfigs.length === 0) {
            throw new Error('Cấu hình Shard không hợp lệ hoặc rỗng.');
        }

        this.shardConfigs = shardConfigs;
        this.shardCount = shardConfigs.length;
        this.pools = new Map();
        this._initPools();
    }

    /**
     * Khởi tạo Connection Pool riêng rẽ cho từng Shard vật lý
     */
    _initPools() {
        for (const cfg of this.shardConfigs) {
            const pool = mysql.createPool({
                host: cfg.host,
                port: cfg.port,
                user: cfg.user,
                password: cfg.password,
                database: cfg.database,
                waitForConnections: true,
                connectionLimit: cfg.connectionLimit || 20,
                queueLimit: 0,
                enableKeepAlive: true,
                keepAliveInitialDelay: 10000
            });

            this.pools.set(cfg.shardId, pool);
        }
    }

    /**
     * Thuật toán băm CRC32 định tuyến tất định (Deterministic Hash Routing)
     * Công thức: ShardIndex = CRC32(ShardingKey) mod N
     * 
     * @param {string|number|bigint} shardingKey - Khóa phân mảnh (thường là user_id)
     * @returns {number} Shard Index (0 <= index < shardCount)
     */
    route(shardingKey) {
        if (shardingKey === undefined || shardingKey === null) {
            throw new Error('Sharding Key không được để trống.');
        }

        const keyStr = String(shardingKey);
        // zlib.crc32 trả về số nguyên 32-bit không dấu (Unsigned 32-bit Integer)
        const hashValue = zlib.crc32(keyStr);
        const shardIndex = hashValue % this.shardCount;

        return shardIndex;
    }

    /**
     * Lấy pool tương ứng với shardIndex
     * @param {number} shardIndex 
     * @returns {mysql.Pool}
     */
    getPool(shardIndex) {
        const pool = this.pools.get(shardIndex);
        if (!pool) {
            throw new Error(`Không tìm thấy Connection Pool cho Shard Index: ${shardIndex}`);
        }
        return pool;
    }

    /**
     * Lấy danh sách tất cả các pool phục vụ cơ chế Scatter-Gather
     * @returns {Array<{shardId: number, pool: mysql.Pool, config: object}>}
     */
    getAllPools() {
        return this.shardConfigs.map(cfg => ({
            shardId: cfg.shardId,
            pool: this.pools.get(cfg.shardId),
            config: cfg
        }));
    }

    /**
     * Kiểm tra trạng thái kết nối tới tất cả các Shard
     */
    async healthCheck() {
        const results = [];
        for (const cfg of this.shardConfigs) {
            const pool = this.pools.get(cfg.shardId);
            try {
                const conn = await pool.getConnection();
                await conn.ping();
                conn.release();
                results.push({
                    shardId: cfg.shardId,
                    database: cfg.database,
                    host: cfg.host,
                    port: cfg.port,
                    status: 'UP'
                });
            } catch (err) {
                results.push({
                    shardId: cfg.shardId,
                    database: cfg.database,
                    host: cfg.host,
                    port: cfg.port,
                    status: 'DOWN',
                    error: err.message
                });
            }
        }
        return results;
    }

    /**
     * Đóng tất cả các Pool (Graceful Shutdown)
     */
    async closeAll() {
        for (const [shardId, pool] of this.pools.entries()) {
            await pool.end();
        }
    }
}

module.exports = {
    ShardConnectionPoolManager
};
