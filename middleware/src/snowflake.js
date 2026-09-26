/**
 * snowflake.js
 * 
 * PHÂN HỆ: CƠ CHẾ SINH KHÓA CHÍNH PHÂN TÁN 64-BIT (TWITTER SNOWFLAKE ALGORITHM)
 * 
 * Đặc tả phân bổ 64 bit (BigInt):
 *  - 1 bit : Sign Bit (luôn bằng 0 để đảm bảo số nguyên dương)
 *  - 41 bit: Timestamp (số miligiây tính từ Custom Epoch, hỗ trợ ~69.7 năm)
 *  - 5 bit : Datacenter ID (0 - 31)
 *  - 5 bit : Worker / Node ID (0 - 31)
 *  - 12 bit: Sequence Number (0 - 4095, tối đa 4096 ID/ms/worker)
 */

class SnowflakeIdGenerator {
    /**
     * @param {number|bigint} datacenterId - Định danh Datacenter (0 -> 31)
     * @param {number|bigint} workerId - Định danh Worker Node (0 -> 31)
     * @param {bigint} [customEpoch=1704067200000n] - Epoch tùy chỉnh (mặc định 2024-01-01T00:00:00.000Z)
     */
    constructor(datacenterId = 1, workerId = 1, customEpoch = 1704067200000n) {
        this.epoch = BigInt(customEpoch);

        // Số lượng bit phân bổ cho từng phần
        this.sequenceBits = 12n;
        this.workerIdBits = 5n;
        this.datacenterIdBits = 5n;

        // Tính toán các ngưỡng cực đại bằng phép dịch bit toán học
        this.maxWorkerId = -1n ^ (-1n << this.workerIdBits);         // 31 (2^5 - 1)
        this.maxDatacenterId = -1n ^ (-1n << this.datacenterIdBits); // 31 (2^5 - 1)
        this.maxSequence = -1n ^ (-1n << this.sequenceBits);         // 4095 (2^12 - 1)

        // Vị trí dịch bit (Bit Shifts)
        this.workerIdShift = this.sequenceBits; // 12
        this.datacenterIdShift = this.sequenceBits + this.workerIdBits; // 17
        this.timestampLeftShift = this.sequenceBits + this.workerIdBits + this.datacenterIdBits; // 22

        const bDatacenterId = BigInt(datacenterId);
        const bWorkerId = BigInt(workerId);

        if (bDatacenterId < 0n || bDatacenterId > this.maxDatacenterId) {
            throw new Error(`Datacenter ID vượt quá phạm vi cho phép: [0, ${this.maxDatacenterId}]. Giá trị nhận: ${datacenterId}`);
        }
        if (bWorkerId < 0n || bWorkerId > this.maxWorkerId) {
            throw new Error(`Worker ID vượt quá phạm vi cho phép: [0, ${this.maxWorkerId}]. Giá trị nhận: ${workerId}`);
        }

        this.datacenterId = bDatacenterId;
        this.workerId = bWorkerId;

        this.sequence = 0n;
        this.lastTimestamp = -1n;
    }

    /**
     * Lấy mốc thời gian hiện tại của hệ điều hành (miligiây)
     * @returns {bigint}
     */
    _timeGen() {
        return BigInt(Date.now());
    }

    /**
     * Chờ tích cực (Spinlock) cho đến khi đồng hồ chuyển sang miligiây kế tiếp
     * @param {bigint} lastTimestamp 
     * @returns {bigint}
     */
    _tilNextMillis(lastTimestamp) {
        let timestamp = this._timeGen();
        while (timestamp <= lastTimestamp) {
            timestamp = this._timeGen();
        }
        return timestamp;
    }

    /**
     * Sinh khóa chính phân tán 64-bit kế tiếp
     * Đảm bảo tính đơn điệu tăng dần, thread-safe đơn tiến trình và kiểm soát clock drift
     * @returns {string} ID biểu diễn dưới dạng chuỗi String thập phân
     */
    nextId() {
        let timestamp = this._timeGen();

        // XỬ LÝ SỰ CỐ ĐỒNG HỒ THỤT LÙI (Clock Backward Drift)
        if (timestamp < this.lastTimestamp) {
            const offset = this.lastTimestamp - timestamp;
            // Nếu trôi thời gian nhỏ hơn hoặc bằng 5ms (thường do NTP sync tinh chỉnh), chờ bù
            if (offset <= 5n) {
                timestamp = this._tilNextMillis(this.lastTimestamp);
            } else {
                throw new Error(`SỰ CỐ CLOCK DRIFT: Đồng hồ hệ thống thụt lùi ${offset}ms so với lần sinh ID gần nhất. Từ chối sinh ID để chống trùng lặp!`);
            }
        }

        // TRƯỜNG HỢP 1: Sinh ID trong cùng một miligiây
        if (this.lastTimestamp === timestamp) {
            this.sequence = (this.sequence + 1n) & this.maxSequence;
            // Đã đạt tới ngưỡng 4096 ID trong ms hiện tại, chờ sang ms kế tiếp
            if (this.sequence === 0n) {
                timestamp = this._tilNextMillis(this.lastTimestamp);
            }
        } else {
            // TRƯỜNG HỢP 2: Đã sang miligiây mới, khởi tạo lại sequence
            this.sequence = 0n;
        }

        this.lastTimestamp = timestamp;

        // PHÉP DỊCH VÀ HỢP BIT (Bitwise OR & Shift)
        const id = ((timestamp - this.epoch) << this.timestampLeftShift) |
                   (this.datacenterId << this.datacenterIdShift) |
                   (this.workerId << this.workerIdShift) |
                   this.sequence;

        return id.toString();
    }

    /**
     * Giải mã cấu trúc nội tại của một Snowflake ID (Dùng cho kiểm tra và phân tích)
     * @param {string|bigint} idString 
     * @returns {object} Thông tin chi tiết giải mã từ các bit
     */
    parseId(idString) {
        const id = BigInt(idString);
        const sequence = id & this.maxSequence;
        const workerId = (id >> this.workerIdShift) & this.maxWorkerId;
        const datacenterId = (id >> this.datacenterIdShift) & this.maxDatacenterId;
        const timestampOffset = id >> this.timestampLeftShift;
        const realTimestamp = timestampOffset + this.epoch;
        const date = new Date(Number(realTimestamp));

        return {
            id: id.toString(),
            timestampOffset: timestampOffset.toString(),
            realTimestamp: realTimestamp.toString(),
            generatedAt: date.toISOString(),
            datacenterId: Number(datacenterId),
            workerId: Number(workerId),
            sequence: Number(sequence)
        };
    }
}

// Khởi tạo Singleton Instance mặc định
const idGenerator = new SnowflakeIdGenerator(
    process.env.DATACENTER_ID || 1,
    process.env.WORKER_ID || 1
);

module.exports = {
    SnowflakeIdGenerator,
    idGenerator
};
