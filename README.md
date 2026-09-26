# HỆ THỐNG PHÂN MẢNH CƠ SỞ DỮ LIỆU (DATABASE SHARDING SYSTEM)

Đồ án tốt nghiệp: **Thiết kế và hiện thực hóa hệ thống Phân mảnh cơ sở dữ liệu (Database Sharding & Horizontal Partitioning) cho ứng dụng quy mô lớn**.

---

## 🎯 1. BỐI CẢNH, ĐẶT VẤN ĐỀ VÀ BÀI TOÁN KỸ THUẬT

### 1.1. Giới hạn vật lý của Cơ sở dữ liệu Nguyên khối (Monolithic Database Bottlenecks)
Trong kỷ nguyên ứng dụng web quy mô lớn (hàng triệu người dùng hoạt động đồng thời, hàng trăm triệu bản ghi giao dịch), mô hình cơ sở dữ liệu quan hệ truyền thống (RDBMS tập trung) nhanh chóng chạm ngưỡng chịu tải vật lý:
1. **Nghẽn cổ chai I/O đĩa cứng (Disk I/O Bottleneck)**: Tần suất đọc/ghi đồng thời vượt quá năng lực xử lý IOPS của hệ thống lưu trữ, gây hàng đợi I/O dài (I/O Wait cao).
2. **Cạn kiệt Bộ nhớ đệm (Buffer Pool / RAM Saturation)**: Kích thước tập chỉ mục (B+Tree Indexes) và tập dữ liệu làm việc (Working Set) vượt quá dung lượng RAM, buộc cơ sở dữ liệu phải tráo đổi (swap) dữ liệu liên tục từ đĩa, làm sụt giảm thông lượng nghiêm trọng.
3. **Giới hạn Kết nối và Khóa Tranh chấp (Lock Contention & Max Connections)**: Hàng nghìn kết nối đồng thời dẫn đến hiện tượng tranh chấp khóa bảng/khóa hàng (Row-level lock contention, Mutex contention), làm tê liệt luồng xử lý của ứng dụng.
4. **Giới hạn của Mở rộng theo chiều dọc (Vertical Scaling - Scale-Up)**: Nâng cấp phần cứng máy chủ (CPU, RAM, NVMe) rất đắt đỏ, chạm trần giới hạn vật lý và vẫn tồn tại điểm nghẽn chịu lỗi tập trung (**Single Point of Failure - SPOF**).

### 1.2. Bài toán đặt ra
Làm thế nào để **mở rộng theo chiều ngang (Horizontal Scaling / Scale-Out)** một cơ sở dữ liệu quan hệ (MySQL) thành cụm phân tán nhiều node độc lập (**Shared-Nothing Architecture**) sao cho:
- **Tăng dung lượng và thông lượng tuyến tính** khi bổ sung phần cứng giá rẻ.
- **Minh bạch vị trí lưu trữ (Location Transparency)**: Tầng ứng dụng giao tiếp tự nhiên qua API mà không cần tự quản lý logic phân tán phức tạp ở từng màn hình nghiệp vụ.
- **Bảo toàn tính nhất quán và toàn vẹn dữ liệu** trên toàn cụm phân mảnh.

---

## 💡 2. TẠI SAO PHẢI ÁP DỤNG CÁC KỸ THUẬT NÀY? (RATIONALE & ARCHITECTURAL DECISIONS)

Để giải quyết bài toán trên một cách bài bản và chuẩn khoa học máy tính, hệ thống đã lựa chọn và kết hợp 4 kỹ thuật nền tảng:

### 2.1. Phân mảnh ngang dựa trên Hàm băm (Hash-based Horizontal Sharding)
- **Vấn đề của Range-based Sharding**: Nếu chia shard theo dải ID (ví dụ Shard 0: 1-1M, Shard 1: 1M-2M) hoặc theo mốc thời gian, toàn bộ các lượt ghi mới luôn đổ dồn vào Shard chứa dải số mới nhất. Điều này tạo ra hiện tượng **Write Hotspot** (Shard mới nhất bị nghẽn trong khi các Shard cũ rảnh rỗi).
- **Lý do chọn Hash Sharding ($ShardIndex = \mathcal{H}(Key) \pmod N$)**: Phân phối giả ngẫu nhiên nhưng có tính **tất định (*deterministic*)**, dàn đều áp lực ghi và dung lượng đĩa lên toàn bộ các node phân mảnh, xóa bỏ hoàn toàn Write Hotspot.
- **Lý do chọn thuật toán CRC32**: Khác với MD5 hay SHA-256 (hàm băm mật mã tốn nhiều chu kỳ CPU), CRC32 là hàm băm phi mật mã được hỗ trợ tập lệnh SSE4.2 trực tiếp trên thanh ghi vi xử lý, cho tốc độ tính toán gần như tức thì ($O(1)$) và phân bố dữ liệu cực kỳ đồng đều (hệ số biến thiên $CV \approx 1.16\%$).

### 2.2. Cơ chế Sinh khóa chính phân tán 64-bit (Twitter Snowflake Algorithm)
- **Vấn đề của `AUTO_INCREMENT` truyền thống**: Trong kiến trúc Shared-Nothing, các node Shard tách biệt độc lập. Cả Shard 0, 1 và 2 đều sẽ tự động sinh ra các ID giống nhau: $1, 2, 3...$, dẫn đến **Xung đột khóa chính toàn cục (ID Collision)**, làm vỡ tính toàn vẹn khi tổng hợp dữ liệu hoặc thực hiện phân tích xuyên shard.
- **Vấn đề của UUID v4**: UUID ngẫu nhiên dài tới 128 bit (16 bytes chuỗi hex), làm phình to bộ nhớ chỉ mục B+Tree. Nguy hiểm hơn, tính ngẫu nhiên làm xáo trộn thứ tự chèn, gây hiện tượng vỡ trang (*Page Split*) liên tục trên đĩa cứng của InnoDB.
- **Lý do chọn Twitter Snowflake ID**:
  1. Dung lượng chuẩn **64-bit BigInt** (khớp hoàn hảo với `BIGINT UNSIGNED` của MySQL).
  2. **Đơn điệu tăng dần theo thời gian (K-Ordered)**: Cực kỳ thân thiện với cấu trúc B+Tree, giúp thao tác ghi mới chỉ việc ghi nối đuôi trang cuối (*Append-only*), tối ưu hóa hiệu năng I/O.
  3. **Hoàn toàn phi tập trung**: Các worker node tự sinh ID độc lập đạt thông lượng $> 1.5$ triệu ID/giây mà không cần gọi qua mạng tới bất kỳ Ticket Server nào (xóa bỏ SPOF).

### 2.3. Lớp Sharding Middleware với Connection Pooling Độc lập
- **Vấn đề kết nối dùng chung**: Nếu gom kết nối của các shard vào một pool chung, khi 1 Shard gặp sự cố mạng hoặc bị khóa bảng, toàn bộ socket của Middleware sẽ bị chiếm giữ bởi Shard đó, gây nghẽn hàng đợi (**Head-of-Line Blocking**) và làm các Shard khỏe mạnh khác bị tê liệt dây chuyền (**Resource Starvation**).
- **Lý do chọn Dedicated Pool per Shard**: Mỗi Shard vật lý được cô lập một Connection Pool riêng biệt (`mysql2/promise`). Việc này thiết lập ranh giới cách ly tài nguyên (*Fault Isolation Boundary*), đồng thời tái sử dụng các kết nối TCP dài hạn nhằm tránh cạn kiệt cổng mạng (*TIME_WAIT Socket Exhaustion*).

### 2.4. Giải thuật Scatter-Gather cho Truy vấn Phi Sharding Key
- **Vấn đề truy vấn toàn cục**: Khi người dùng tìm kiếm theo thuộc tính không phải Sharding Key (ví dụ `WHERE email = ?`), Middleware không thể biết dữ liệu nằm ở Shard nào nếu không rà soát toàn bộ.
- **Lý do áp dụng Parallel Fan-Out (Scatter-Gather)**: Tận dụng cơ chế Non-blocking I/O và `Promise.all()` của Node.js để phát tán truy vấn đồng thời tới $N$ Shard song song. Sau đó thu thập (*Gather*) và tổng hợp kết quả (*Merge/Reduce*), đảm bảo thời gian phản hồi chỉ phụ thuộc vào Shard chậm nhất chứ không bị tích lũy cộng dồn tuần tự.

---

## 📁 3. CẤU TRÚC THƯ MỤC DỰ ÁN

```text
ChuyenDeKyThuatPhanMem/
│── docker-compose.yml              # Khởi tạo cụm 3 Node MySQL Shard (3307, 3308, 3309)
│── PHASE_1_ARCHITECTURE.md        # Tài liệu thiết kế chi tiết Phase 1 (Kiến trúc & Hạ tầng)
│── PHASE_2_IMPLEMENTATION.md      # Tài liệu thiết kế chi tiết Phase 2 (Middleware & Routing Engine)
│── README.md                      # Hướng dẫn chạy và tổng quan dự án
│── init-scripts/
│   └── 01_init_schema.sql          # Script DDL tự động tạo bảng (users, orders) khi shard khởi chạy
└── middleware/                     # Lớp Sharding Middleware Proxy (Node.js/Express)
    ├── package.json
    ├── .env
    ├── .env.example
    ├── src/
    │   ├── snowflake.js            # Bộ sinh khóa phân tán 64-bit Twitter Snowflake
    │   ├── router.js               # Connection Pool Manager độc lập & CRC32 Modulo Router
    │   └── server.js               # REST API Server (Point Write, Point Read, Scatter-Gather)
    └── tests/
        └── test_routing_snowflake.js # Kiểm thử tự động tính đơn điệu Snowflake & phân bố CRC32
```

---

## 🚀 4. HƯỚNG DẪN KHỞI CHẠY TOÀN BỘ HỆ THỐNG

### Bước 1: Khởi chạy 3 Shard MySQL (Hạ tầng phân tán)
Yêu cầu máy chủ/máy trạm đã bật **Docker Desktop**:
```bash
docker compose up -d
docker compose ps
```
Sau khi khởi chạy, 3 node MySQL Shards độc lập sẽ lắng nghe trên các cổng:
- **Shard 0**: `localhost:3307` (Tên DB: `ecommerce_db`)
- **Shard 1**: `localhost:3308` (Tên DB: `ecommerce_db`)
- **Shard 2**: `localhost:3309` (Tên DB: `ecommerce_db`)

### Bước 2: Khởi chạy Lớp Sharding Middleware
```bash
cd middleware
npm install

# 1. Chạy bài kiểm thử tự động thuật toán Snowflake ID & Hash Routing
npm test

# 2. Khởi động máy chủ Middleware (mặc định Port 3000)
npm start
```

### Bước 3: Kiểm thử REST API (cURL Examples)

#### 1. Kiểm tra Sức khỏe Cụm Shard (Healthcheck)
```bash
curl -X GET http://localhost:3000/api/health
```

#### 2. Ghi Dữ liệu Điểm (Point Insert - Tự động sinh ID 64-bit và định tuyến Shard)
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"username": "nguyenvana", "email": "vana@example.com", "full_name": "Nguyen Van A"}'
```

#### 3. Đọc Dữ liệu Điểm (Point Query - Định tuyến trực tiếp O(1))
```bash
curl -X GET http://localhost:3000/api/users/362152126794829824
```

#### 4. Tìm kiếm Xuyên Phân mảnh (Scatter-Gather Global Search)
```bash
curl -X GET "http://localhost:3000/api/users/search/by-email?email=vana@example.com"
```
