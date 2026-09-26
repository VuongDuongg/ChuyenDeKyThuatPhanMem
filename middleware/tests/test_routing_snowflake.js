/**
 * test_routing_snowflake.js
 * 
 * PHÂN HỆ KIỂM THỬ ĐỘC LẬP:
 * 1. Kiểm tra tính đơn điệu và tính duy nhất của thuật toán Snowflake (10,000 IDs)
 * 2. Kiểm tra tính tất định và độ phân tán (Uniform Distribution) của thuật toán CRC32 % 3
 */

const { SnowflakeIdGenerator } = require('../src/snowflake');
const zlib = require('zlib');

console.log('================================================================');
console.log('BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG: SNOWFLAKE ID & HASH ROUTING (PHASE 2)');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// TEST SUITE 1: KIỂM THỬ SNOWFLAKE ID GENERATOR
// -----------------------------------------------------------------------------
console.log('--- TEST SUITE 1: SNOWFLAKE ID GENERATOR (64-BIT BIGINT) ---');
const generator = new SnowflakeIdGenerator(1, 1);

const TOTAL_IDS = 20000;
const generatedIds = new Set();
let isMonotonic = true;
let previousId = 0n;

const startTime = Date.now();

for (let i = 0; i < TOTAL_IDS; i++) {
    const idStr = generator.nextId();
    const idBig = BigInt(idStr);

    if (idBig <= previousId && i > 0) {
        isMonotonic = false;
        console.error(`[FAIL] Không đảm bảo tính đơn điệu tại bước ${i}: ${idBig} <= ${previousId}`);
        break;
    }

    generatedIds.add(idStr);
    previousId = idBig;
}

const duration = Date.now() - startTime;
const throughput = Math.round((TOTAL_IDS / (duration || 1)) * 1000);

console.log(`- Số lượng ID sinh thử nghiệm : ${TOTAL_IDS.toLocaleString()}`);
console.log(`- Số lượng ID duy nhất (Set) : ${generatedIds.size.toLocaleString()}`);
console.log(`- Thời gian thực thi        : ${duration} ms`);
console.log(`- Thông lượng sinh ID       : ~${throughput.toLocaleString()} IDs/giây`);
console.log(`- Tính duy nhất (Uniqueness): ${generatedIds.size === TOTAL_IDS ? 'PASSED (Không trùng lặp)' : 'FAILED'}`);
console.log(`- Tính đơn điệu (Monotonic) : ${isMonotonic ? 'PASSED (Tăng dần liên tục)' : 'FAILED'}`);

// Kiểm tra giải mã ID (Parse ID test)
const sampleId = generator.nextId();
const parsed = generator.parseId(sampleId);
console.log('\n- Mẫu giải mã cấu trúc Bit của Snowflake ID:');
console.log(`  + Raw ID         : ${parsed.id}`);
console.log(`  + Generated At   : ${parsed.generatedAt}`);
console.log(`  + Datacenter ID  : ${parsed.datacenterId} (Expected: 1)`);
console.log(`  + Worker ID      : ${parsed.workerId} (Expected: 1)`);
console.log(`  + Sequence Number: ${parsed.sequence}`);

if (generatedIds.size !== TOTAL_IDS || !isMonotonic) {
    console.error('\n=> KẾT QUẢ TEST SUITE 1: THẤT BẠI!');
    process.exit(1);
}
console.log('=> KẾT QUẢ TEST SUITE 1: THÀNH CÔNG RỰC RỠ (ALL PASSED)\n');

// -----------------------------------------------------------------------------
// TEST SUITE 2: KIỂM THỬ HASH ROUTING (CRC32 MODULO 3)
// -----------------------------------------------------------------------------
console.log('--- TEST SUITE 2: HASH ROUTING DETERMINISM & DISTRIBUTION ---');

const SHARD_COUNT = 3;
const shardDistribution = { 0: 0, 1: 0, 2: 0 };

function route(key) {
    const hash = zlib.crc32(String(key));
    return hash % SHARD_COUNT;
}

// 1. Kiểm tra tính tất định (Determinism)
const testKey = '123456789012345678';
const shardFirstRun = route(testKey);
let isDeterministic = true;

for (let i = 0; i < 1000; i++) {
    if (route(testKey) !== shardFirstRun) {
        isDeterministic = false;
        break;
    }
}
console.log(`- Tính tất định (1000 lần cùng Key -> Cùng Shard): ${isDeterministic ? 'PASSED (Luôn là Shard ' + shardFirstRun + ')' : 'FAILED'}`);

// 2. Kiểm tra phân phối đều trên tập 20,000 Snowflake IDs
for (const id of generatedIds) {
    const shard = route(id);
    shardDistribution[shard]++;
}

console.log('- Thống kê phân bố 20,000 bản ghi trên 3 Shard:');
for (let s = 0; s < SHARD_COUNT; s++) {
    const count = shardDistribution[s];
    const percentage = ((count / TOTAL_IDS) * 100).toFixed(2);
    console.log(`  + Shard ${s}: ${count.toLocaleString()} keys (${percentage}%)`);
}

// Kiểm tra độ lệch chuẩn phân bố (Standard Deviation check)
const expected = TOTAL_IDS / SHARD_COUNT;
let varianceSum = 0;
for (let s = 0; s < SHARD_COUNT; s++) {
    varianceSum += Math.pow(shardDistribution[s] - expected, 2);
}
const standardDeviation = Math.sqrt(varianceSum / SHARD_COUNT);
const cv = ((standardDeviation / expected) * 100).toFixed(2); // Coefficient of Variation

console.log(`- Hệ số biến thiên phân bố (CV): ${cv}% (Ngưỡng an toàn < 5%)`);

if (cv > 5.0 || !isDeterministic) {
    console.error('\n=> KẾT QUẢ TEST SUITE 2: THẤT BẠI!');
    process.exit(1);
}

console.log('=> KẾT QUẢ TEST SUITE 2: THÀNH CÔNG RỰC RỠ (PHÂN BỐ CỰC ĐỀU & TẤT ĐỊNH)\n');
console.log('================================================================');
console.log('TẤT CẢ CÁC BÀI KIỂM THỬ THUẬT TOÁN ĐÃ ĐẠT TIÊU CHUẨN ĐỒ ÁN!');
console.log('================================================================');
