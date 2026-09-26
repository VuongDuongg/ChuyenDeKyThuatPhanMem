import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ==============================================================================
// 1. TÙY BIẾN CÁC CHỈ SỐ ĐO LƯỜNG CHUYÊN SÂU (CUSTOM BENCHMARK METRICS)
// ==============================================================================
export const writeDuration = new Trend('insert_duration_ms', true);
export const successfulWrites = new Counter('successful_inserts_total');
export const failedWrites = new Counter('failed_inserts_total');
export const errorRate = new Rate('system_error_rate');

// ==============================================================================
// 2. CẤU HÌNH GIAI ĐOẠN RAMPING VIRTUAL USERS (MẶC ĐỊNH HOẶC CHẠY NHANH ĐỂ TEST)
// Chế độ:
//  - Chạy đầy đủ: k6 run load_test_insert.js
//  - Chạy nhanh (Quick Test 30s): k6 run -e QUICK=true load_test_insert.js
// ==============================================================================
const isQuick = __ENV.QUICK === 'true';

export const options = isQuick ? {
    // Chế độ kiểm tra nhanh 30 giây để xác thực hệ thống
    stages: [
        { duration: '10s', target: 20 },
        { duration: '15s', target: 50 },
        { duration: '5s',  target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<300'],
        system_error_rate: ['rate<0.05'],
    },
} : {
    // Chế độ kiểm thử tải tiêu chuẩn cho đồ án (Ramping 10 -> 200 VUs)
    scenarios: {
        benchmark_insert: {
            executor: 'ramping-vus',
            startVUs: 10,
            stages: [
                { duration: '30s', target: 50 },   // Khởi động lên 50 VUs
                { duration: '1m',  target: 100 },  // Đẩy tải lên 100 VUs
                { duration: '1m30s', target: 200 },// Đạt đỉnh tải 200 VUs
                { duration: '1m',  target: 200 },  // Duy trì đỉnh tải 200 VUs
                { duration: '30s', target: 0 },    // Hạ tải về 0
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<250', 'p(99)<500'],
        system_error_rate: ['rate<0.01'],
    },
};

// Địa chỉ Middleware Endpoint (Mặc định http://127.0.0.1:3000)
const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:3000';

// ==============================================================================
// 3. SINH DỮ LIỆU NGẪU NHIÊN ĐẢM BẢO DUY NHẤT & CHỐNG TRÙNG LẶP / CACHE
// ==============================================================================
function generateRandomPayload(vuId, iteration) {
    const timestamp = Date.now();
    const entropy = Math.floor(Math.random() * 1000000);
    const uniqueToken = `${vuId}_${iteration}_${timestamp}_${entropy}`;
    
    return {
        username: `user_${uniqueToken}`,
        email: `tester_${uniqueToken}@loadtest.local`,
        full_name: `Automated Tester VU#${vuId} Iter#${iteration}`,
        password: `Password_${entropy}!@#`
    };
}

// ==============================================================================
// 4. LUỒNG THỰC THI CHÍNH CỦA MỖI VIRTUAL USER
// ==============================================================================
export default function () {
    const payload = JSON.stringify(generateRandomPayload(__VU, __ITER));

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'X-Benchmark-Client': 'k6-Distributed-Load-Generator',
        },
        timeout: '5s',
    };

    const startTime = Date.now();
    const response = http.post(`${BASE_URL}/api/users`, payload, params);
    const duration = Date.now() - startTime;

    writeDuration.add(duration);

    // Xác thực phản hồi
    const isSuccess = check(response, {
        'HTTP Status is 201 Created': (r) => r.status === 201,
        'Has Valid Snowflake ID in body': (r) => {
            if (r.status === 201) {
                try {
                    const body = JSON.parse(r.body);
                    return body.data && body.data.id && typeof body.data.id === 'string';
                } catch (e) {
                    return false;
                }
            }
            return false;
        },
    });

    if (isSuccess) {
        successfulWrites.add(1);
        errorRate.add(0);
    } else {
        failedWrites.add(1);
        errorRate.add(1);
    }

    // Pacing time (50ms) mô phỏng hành vi gọi API liên tục có nhịp nghỉ thực tế
    sleep(0.05);
}
