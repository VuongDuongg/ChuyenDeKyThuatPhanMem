# TÀI LIỆU TỔNG HỢP TOÀN DIỆN VÀ HƯỚNG DẪN BẢO VỆ ĐỒ ÁN TỐT NGHIỆP

**Đề tài**: Thiết kế và hiện thực hóa hệ thống Phân mảnh cơ sở dữ liệu (Database Sharding & Horizontal Partitioning) cho ứng dụng quy mô lớn  
**Chuyên ngành**: Công nghệ Thông tin / Kỹ thuật Phần mềm & Hệ thống Phân tán  
**Tài liệu**: Tổng hợp cốt lõi (Executive Defense & Knowledge Guide)  

---

## MỤC LỤC TỔNG QUAN

1. [TỔNG QUAN ĐỀ TÀI VÀ KIẾN TRÚC TỔNG THỂ](#1-tổng-quan-đề-tài-và-kiến-trúc-tổng-thể)
2. [CHI TIẾT CÁC PHẦN ĐÃ HOÀN THÀNH (WHAT WE BUILT)](#2-chi-tiết-các-phần-đã-hoàn-thành-what-we-built)
3. [CÁC QUYẾT ĐỊNH THIẾT KẾ CỐT LÕI (ARCHITECTURAL DECISIONS & RATIONALE)](#3-các-quyết-định-thiết-kế-cốt-lõi-architectural-decisions--rationale)
4. [SỐ LIỆU ĐO ĐẠC VÀ KẾT QUẢ THỰC NGHIỆM ĐẮT GIÁ (EMPIRICAL METRICS)](#4-số-liệu-đo-đạc-và-kết-quả-thực-nghiệm-đắt-giá-empirical-metrics)
5. [CÁC NHƯỢC ĐIỂM HỆ THỐNG VÀ HƯỚNG PHÁT TRIỂN (HONEST ARCHITECTURAL LIMITATIONS)](#5-các-nhược-điểm-hệ-thống-và-hướng-phát-triển-honest-architectural-limitations)
6. [BỘ CÂU HỎI VÀ KỊCH BẢN TRẢ LỜI PHẢN BIỆN HỘI ĐỒNG (Q&A DEFENSE CHEAT-SHEET)](#6-bộ-câu-hỏi-và-kịch-bản-trả-lời-phản-biện-hội-đồng-qa-defense-cheat-sheet)
7. [CHECKLIST VÀ KỊCH BẢN DEMO TRỰC TIẾP (LIVE DEMO SCRIPT)](#7-checklist-và-kịch-bản-demo-trực-tiếp-live-demo-script)

---

## 1. TỔNG QUAN ĐỀ TÀI VÀ KIẾN TRÚC TỔNG THỂ

### 1.1. Bối cảnh và Bài toán kỹ thuật cốt lõi
- **Giới hạn của Cơ sở dữ liệu Nguyên khối (Monolithic RDBMS)**:
  - Khi dữ liệu vượt ngưỡng hàng trăm triệu bản ghi và lưu lượng truy cập đồng thời tăng vọt, máy chủ đơn lẻ chạm phải **4 giới hạn vật lý**:
    1. *Nghẽn cổ chai I/O đĩa cứng* (Disk I/O Wait cao do ghi chỉ mục B+Tree liên tục).
    2. *Tràn bộ nhớ đệm Buffer Pool* (Tập làm việc Working Set lớn hơn dung lượng RAM, buộc phải tráo đổi đĩa liên tục).
    3. *Tranh chấp khóa và luồng* (Row-level Lock Contention, Mutex Contention và cạn kiệt `max_connections`).
    4. *Chi phí mở rộng theo chiều dọc (Vertical Scaling / Scale-Up)* quá đắt đỏ và vẫn tiềm ẩn nguy cơ điểm lỗi đơn lẻ (Single Point of Failure - SPOF).
- **Mục tiêu của Đồ án**:
  - Xây dựng một hệ sinh thái phân mảnh ngang (*Horizontal Sharding*) theo kiến trúc **Shared-Nothing**, mở rộng theo chiều ngang (*Scale-Out*), đảm bảo tính **minh bạch vị trí (Location Transparency)** đối với tầng ứng dụng, duy trì tính toàn vẹn dữ liệu và tối ưu hóa hiệu năng đọc/ghi.

### 1.2. Mô hình Kiến trúc 3 Tầng (3-Tier Transparent Sharding Architecture)

```
                            [ Client / k6 Generator ]
                                       │
                                       │ HTTP / REST API (JSON)
                                       ▼
     ┌────────────────────────────────────────────────────────────────────────┐
     │            TẦNG SHARDING MIDDLEWARE ROUTING PROXY (Port 3000)          │
     │                                                                        │
     │  ┌──────────────────────┐                     ┌─────────────────────┐  │
     │  │ Snowflake ID Gen     │                     │ CRC32 Router Engine │  │
     │  │ (64-bit BigInt)      │                     │ (Hash(Key) mod N)   │  │
     │  └──────────┬───────────┘                     └──────────┬──────────┘  │
     │             │                                            │             │
     │             └─────────────────────┬──────────────────────┘             │
     │                                   │                                    │
     │               ┌───────────────────▼───────────────────┐                │
     │               │  Dedicated Connection Pool Manager    │                │
     │               │  (Pool 0: 20 | Pool 1: 20 | Pool 2: 20│                │
     │               └─────┬─────────────┬─────────────┬─────┘                │
     └─────────────────────┼─────────────┼─────────────┼──────────────────────┘
                           │ TCP (3307)  │ TCP (3308)  │ TCP (3309)
                           ▼             ▼             ▼
                   +──────────────+ +──────────────+ +──────────────+
                   │   SHARD 0    │ │   SHARD 1    │ │   SHARD 2    │
                   │ (db_shard_0) │ │ (db_shard_1) │ │ (db_shard_2) │
                   │  MySQL 8.0   │ │  MySQL 8.0   │ │  MySQL 8.0   │
                   +──────────────+ +──────────────+ +──────────────+
```

---

## 2. CHI TIẾT CÁC PHẦN ĐÃ HOÀN THÀNH (WHAT WE BUILT)

Dự án đã được triển khai hoàn chỉnh qua **3 giai đoạn** với đầy đủ mã nguồn và hạ tầng:

### Giai đoạn 1: Hạ tầng Phân tán & Thiết kế Lược đồ (Phase 1)
- **Hạ tầng Docker Compose (`docker-compose.yml`)**:
  - Khởi tạo cụm 3 node MySQL 8.0 hoàn toàn độc lập theo kiến trúc *Shared-Nothing*:
    - `db_shard_0` (Port máy Host: `3307`)
    - `db_shard_1` (Port máy Host: `3308`)
    - `db_shard_2` (Port máy Host: `3309`)
  - Mỗi Shard sở hữu bộ nhớ đệm InnoDB riêng, volume lưu trữ riêng và mạng subnet biệt lập (`172.28.0.0/16`).
- **Thiết kế Lược đồ Sharding & Dữ liệu đồng vị trí (Colocated Tables)**:
  - Bảng `users`: Khóa chính `id` đóng vai trò là **Sharding Key**.
  - Bảng `orders`: Khóa chính kết hợp `(id, user_id)`, trong đó `user_id` đóng vai trò là **Sharding Key**.
  - *Ý nghĩa kiến trúc*: Cho phép thực hiện phép `JOIN` giữa `users` và `orders` ngay trên cùng một node Shard cục bộ mà **không phát sinh Cross-Shard JOIN**.

### Giai đoạn 2: Lớp Sharding Middleware & Xử lý Truy vấn (Phase 2)
1. **Bộ sinh khóa phân tán Twitter Snowflake (`middleware/src/snowflake.js`)**:
   - Hiện thực hóa thuật toán 64-bit bằng `BigInt` nguyên bản của JavaScript.
   - Cấu trúc: `1 bit sign` (0) + `41 bit timestamp` + `5 bit datacenter` + `5 bit worker` + `12 bit sequence`.
   - **Xử lý Clock Drift**: Dùng spinlock chờ bù nếu trôi $\le 5$ ms; ném exception nếu trôi $> 5$ ms để bảo vệ $100\%$ không bị trùng lặp.
   - **Xử lý Sequence Overflow**: Tự động spinlock chờ sang miligiây kế tiếp nếu vượt quá 4096 ID/ms.
2. **Quản lý Connection Pool Độc lập (`middleware/src/router.js`)**:
   - Sử dụng `mysql2/promise` thiết lập từng Pool riêng cho từng Shard (cách ly ranh giới tài nguyên mạng).
   - Thiết lập `enableKeepAlive: true`, kiểm soát tổng kết nối $\sum \text{PoolSize}_i \le \text{max\_connections}$.
3. **Định tuyến Băm Tất định (Hash Routing Engine)**:
   - Thuật toán: $\text{ShardIndex} = \text{CRC32}(\text{user\_id}) \pmod 3$.
   - Tính toán trực tiếp trên thanh ghi phần cứng (hỗ trợ tập lệnh SSE4.2), độ phức tạp $O(1)$.
4. **Hệ thống REST API Hoàn chỉnh (`middleware/src/server.js`)**:
   - `POST /api/users` (**Point Insert**): Sinh Snowflake ID $\to$ Băm CRC32 $\to$ Ghi trực tiếp đúng Shard.
   - `GET /api/users/:id` (**Point Query**): Băm CRC32 trích xuất Shard đích $\to$ Đọc trực tiếp $O(1)$ chỉ trên 1 Shard.
   - `GET /api/users/search/by-email` (**Scatter-Gather**): Truy vấn theo trường không chứa Sharding Key $\to$ Parallel Fan-Out bằng `Promise.all()` tới cả 3 Shards $\to$ Gather kết quả $\to$ Merge & Reduce trả về client kèm đo lường Telemetry độ trễ.
   - `GET /api/health`: Healthcheck trạng thái kết nối của toàn cụm Shards.

### Giai đoạn 3: Kiểm thử Tải & Đo chuẩn Đối chiếu (Phase 3)
- **Quy tắc Chuẩn hóa Tài nguyên (Resource Equalization Rule)**:
  - Đảm bảo công bằng khoa học: Tổng tài nguyên của 3 Shard ($3 \times 0.67$ vCPU = 2.0 Cores, $3 \times 512$ MB RAM = 1.5 GB RAM, $3 \times 256$ MB Buffer Pool = 768 MB) được thiết lập bằng đúng 1 máy chủ Monolithic duy nhất ($2.0$ vCPU, $1.5$ GB RAM, $768$ MB Buffer Pool).
- **Kịch bản kiểm thử tải với k6**:
  - Đo lường Point Insert Stress Test & Point Query Stress Test.

---

## 3. CÁC QUYẾT ĐỊNH THIẾT KẾ CỐT LÕI (ARCHITECTURAL DECISIONS & RATIONALE)

Khi bảo vệ trước hội đồng, sinh viên phải chứng minh được **"Tại sao lại chọn giải pháp này mà không chọn giải pháp khác?"**:

### 3.1. Tại sao dùng Sharding mà không chỉ dùng Redis hoặc Kafka?
- **Ranh giới nhiệm vụ (Separation of Concerns)**:
  - **Redis (Caching Layer)**: Tối ưu độ trễ đọc trong RAM. Nhưng chi phí RAM quá đắt đỏ (lưu hàng TB dữ liệu bằng RAM là bất khả thi về mặt kinh tế), nguy cơ mất mát dữ liệu khi khởi động lại, và không có tính năng truy vấn quan hệ / ACID.
  - **Kafka (Messaging Layer)**: Là Append-only Log tuần tự, không hỗ trợ đọc điểm ngẫu nhiên $O(1)$ (`WHERE id = ?`) và không thể cập nhật tại chỗ (`UPDATE`).
  - **Database Sharding (Persistence Layer)**: Là **System of Record (Single Source of Truth)**. Lưu trữ vĩnh viễn, bền vững trên ổ đĩa, đảm bảo ACID và là "chốt chặn bảo vệ cuối cùng" khi xảy ra hiện tượng *Cache Miss* hoặc *Cold Data Lookup*.
- **Kết luận**: Cả ba bổ trợ cho nhau chứ không thay thế nhau: `Kafka -> Sharded DB -> Redis`.

### 3.2. Tại sao dùng Twitter Snowflake ID thay vì `AUTO_INCREMENT` hay `UUID v4`?
- **Khuyết tật của `AUTO_INCREMENT`**: Trong hệ thống đa Shard độc lập, cả Shard 0, 1 và 2 đều sẽ tự sinh ID $1, 2, 3... \implies$ Dẫn đến **Xung đột khóa chính toàn cục (ID Collision)**.
- **Khuyết tật của `UUID v4`**: 
  - Dung lượng lớn (128-bit / 36 ký tự chuỗi), làm phình to bộ nhớ chỉ mục.
  - **Tính ngẫu nhiên phá hủy B+Tree**: Chèn bản ghi lung tung vào các trang dữ liệu của InnoDB, gây ra hiện tượng **Page Split liên tục**, làm giảm tốc độ ghi đĩa tới $60\% - 80\%$.
- **Ưu thế vượt trội của Snowflake ID**:
  - Chuẩn số nguyên 64-bit khớp hoàn hảo với `BIGINT UNSIGNED` của MySQL.
  - **Đơn điệu tăng dần theo thời gian (K-Ordered)**: Luôn chèn nối đuôi vào trang cuối của B+Tree (Append-only write), tối đa hóa tốc độ ghi.
  - **Phi tập trung**: Middleware tự sinh ID trong RAM đạt $>1.5$ triệu ID/giây mà không cần gọi qua mạng tới Ticket Server nào.

### 3.3. Tại sao chọn CRC32 thay vì MD5 / SHA-256?
- **MD5 / SHA-256**: Là hàm băm mật mã, tiêu tốn rất nhiều chu kỳ CPU để lặp vòng mã hóa, gây độ trễ microsecond tích lũy không cần thiết trên tầng Middleware.
- **CRC32**: Là hàm băm phi mật mã, xử lý trực tiếp trên thanh ghi vi xử lý bằng tập lệnh phần cứng **SSE4.2**. Tốc độ tính toán gần như tức thì ($<1 \mu s$), tính tất định $100\%$ và độ phân tán dữ liệu cực kỳ đồng đều.

### 3.4. Tại sao lại dùng Dedicated Connection Pool riêng cho từng Shard?
- Ngăn ngừa hiện tượng **Head-of-Line Blocking** và **Cross-Resource Starvation**: Nếu dùng chung 1 pool, khi Shard 2 bị khóa bảng hoặc I/O chậm, toàn bộ socket kết nối của ứng dụng sẽ bị dồn vào Shard 2, làm tê liệt các truy vấn tới Shard 0 và Shard 1.
- Tái sử dụng kết nối TCP để triệt tiêu lỗi cạn kiệt cổng mạng (**TIME_WAIT Socket Exhaustion**).

---

## 4. SỐ LIỆU ĐO ĐẠC VÀ KẾT QUẢ THỰC NGHIỆM ĐẮT GIÁ (EMPIRICAL METRICS)

Toàn bộ các số liệu dưới đây đã được đo đạc trực tiếp từ các bài kiểm thử thực tế trong dự án:

### 4.1. Kết quả Kiểm thử Thuật toán Snowflake ID (`tests/test_routing_snowflake.js`)
- **Tập mẫu thử nghiệm**: $20,000$ ID liên tục.
- **Thời gian sinh $20,000$ ID**: **$13$ ms**.
- **Thông lượng sinh khóa**: **$\approx 1,538,462$ IDs / giây** (trên 1 luồng đơn của CPU).
- **Tỷ lệ trùng lặp**: **$0\%$** ($20,000 / 20,000$ ID là duy nhất).
- **Tính đơn điệu**: **$100\%$** ($ID_{k+1} > ID_k$ được duy trì liên tục).

### 4.2. Kết quả Phân bố Dữ liệu của Hàm Băm CRC32 Modulo 3
Thống kê vị trí lưu trữ của $20,000$ bản ghi trên 3 Shard:
- **Shard 0**: $6,747$ keys (**$33.73\%$**)
- **Shard 1**: $6,562$ keys (**$32.81\%$**)
- **Shard 2**: $6,691$ keys (**$33.45\%$**)
- **Hệ số biến thiên phân bố (Coefficient of Variation - CV)**:
  $$\sigma = 77.86, \quad \mu = 6666.67 \implies CV = \frac{\sigma}{\mu} = \mathbf{1.16\%}$$
- *Ý nghĩa*: $CV = 1.16\%$ thấp hơn rất nhiều so với ngưỡng an toàn kỹ thuật là $5\%$, chứng minh thuật toán phân bổ tải cực kỳ đồng đều, triệt tiêu nguy cơ lệch tải bộ nhớ giữa các máy chủ.

### 4.3. Đánh giá Hiệu năng: Monolithic vs. Sharded Cluster (Tổng hợp Phase 3)
- **Tải Ghi chuyên sâu (Point Insert)**:
  - Hệ thống Sharded tăng thông lượng ghi bền vững (TPS) thêm **$150\% - 220\%$** so với Monolithic trên cùng tổng tài nguyên phần cứng.
  - Phân tán tranh chấp `InnoDB Buffer Pool Mutex` và `Redo Log Buffer Contention` từ 1 node sang 3 nodes độc lập.
- **Độ trễ Đuôi ($p95, p99$)**:
  - Ở mức tải cao (500+ Virtual Users), $p99$ của hệ thống Monolithic tăng vọt do nghẽn hàng đợi kết nối, trong khi hệ thống Sharded duy trì được dải phân vị độ trễ ổn định.

---

## 5. CÁC NHƯỢC ĐIỂM HỆ THỐNG VÀ HƯỚNG PHÁT TRIỂN (HONEST ARCHITECTURAL LIMITATIONS)

Người làm kỹ thuật giỏi không chỉ biết khen hệ thống của mình mà phải **nhận diện rõ các giới hạn kiến trúc** và có lộ trình giải quyết:

| Điểm yếu kiến trúc | Hệ quả kỹ thuật | Giải pháp khắc phục chuẩn công nghiệp |
| :--- | :--- | :--- |
| **Bão di chuyển dữ liệu khi Scale-out (Rehashing Storm)** | Khi tăng từ $N=3$ lên $N=4$, công thức $\text{CRC32} \pmod N$ khiến **$75\%$ dữ liệu hiện có bị lệch vị trí**, gây bão I/O mạng khổng lồ khi di trú dữ liệu. | **Consistent Hashing (Vòng băm nhất quán với Virtual Nodes)**: Khi thêm 1 shard, chỉ cần di chuyển tối thiểu $1/(N+1)$ lượng dữ liệu. |
| **Vấn đề Hotspot Shard (Celebrity Problem)** | Người dùng có lượng tương tác khổng lồ (KOL, cửa hàng lớn) có chung `user_id`, toàn bộ dữ liệu dồn về đúng 1 Shard gây sập Shard đó. | **Salted Sharding Key**: Kết hợp `user_id + random_suffix` để chia nhỏ bảng con, hoặc tách riêng tài khoản VIP sang cụm Dedicated Shard. |
| **Độ trễ đuôi của Scatter-Gather** | Tìm kiếm theo `email` phải phát tán tới cả $N$ Shard. Thời gian phản hồi bị trói chặt bởi Shard chậm nhất ($T = \max(T_i)$). | **Global Secondary Index (GSI) qua Redis**: Lưu bảng tra cứu `email -> user_id` trong Redis để biến mọi truy vấn tìm kiếm thành Point Lookup $O(1)$. |
| **Không hỗ trợ máy chủ lệch cấu hình** | Phép $\pmod N$ chia đều $1:1:1$, nếu Shard 0 mạnh gấp đôi Shard 1 thì Shard 0 vẫn chỉ nhận $1/3$ dữ liệu (lãng phí phần cứng). | **Weighted Consistent Hashing**: Cấp cho máy mạnh nhiều Virtual Nodes hơn trên vòng tròn Hash Ring. |

---

## 6. BỘ CÂU HỎI VÀ KỊCH BẢN TRẢ LỜI PHẢN BIỆN HỘI ĐỒNG (Q&A DEFENSE CHEAT-SHEET)

### Câu hỏi 1: "Tại sao không dùng Read Replicas (Master-Slave) mà phải làm Sharding cho phức tạp?"
- **Trả lời**:  
  > *"Thưa thầy/cô, mô hình Master-Slave (Read Replicas) chỉ giải quyết được bài toán **Scale-out cho thao tác ĐỌC**, trong khi toàn bộ thao tác **GHI** vẫn phải dồn vào duy nhất 1 node Master. Hơn nữa, tổng dung lượng lưu trữ của hệ thống vẫn bị giới hạn bởi dung lượng đĩa cứng của node Master đó. Đề tài của em giải quyết bài toán quy mô lớn khi cả **năng lực GHI (Write Throughput)** lẫn **dung lượng lưu trữ dữ liệu** đều vượt quá giới hạn của 1 máy chủ, do đó bắt buộc phải phân mảnh ngang (Sharding) theo kiến trúc Shared-Nothing."*

---

### Câu hỏi 2: "Tại sao em không dùng UUID v4 cho tiện mà phải tự viết class Snowflake ID?"
- **Trả lời**:  
  > *"Thưa thầy/cô, UUID v4 có 2 nhược điểm chí mạng đối với MySQL InnoDB:  
  > Thứ nhất, kích thước 128-bit làm tăng kích thước chỉ mục B+Tree.  
  > Thứ hai và quan trọng nhất, UUID mang tính ngẫu nhiên, khi chèn vào bảng InnoDB sẽ làm vỡ trang dữ liệu (Page Split) liên tục, buộc đĩa cứng phải dịch chuyển đầu từ để sắp xếp lại cây B+Tree, làm tốc độ ghi giảm tới $60\%-80\%$.  
  > Thuật toán Snowflake ID do em hiện thực hóa có 41-bit thời gian ở đầu, đảm bảo tính **đơn điệu tăng dần (K-Ordered)**, giúp MySQL luôn thực hiện chèn nối đuôi trang cuối (Append-only write), tối ưu hóa triệt để hiệu năng đĩa cứng."*

---

### Câu hỏi 3: "Hiện tại hệ thống dùng `CRC32 % 3`, nếu năm sau tôi muốn nâng cấp lên 4 Shards thì hệ thống xử lý thế nào?"
- **Trả lời**:  
  > *"Thưa thầy/cô, đây chính là hạn chế kinh điển của giải thuật Modulo Sharding. Về mặt toán học, khi chuyển từ Modulo 3 sang Modulo 4, xác suất một key giữ nguyên vị trí chỉ là $1/4 = 25\%$, đồng nghĩa với việc $75\%$ dữ liệu hiện có trong hệ thống phải dịch chuyển qua mạng giữa các máy chủ.  
  > Với hệ thống cố định số Shard, CRC32 Modulo là giải pháp tối ưu nhất vì tính toán $O(1)$ siêu nhanh. Nhưng để hỗ trợ mở rộng động (Elastic Scaling) mà không gây bão di trú dữ liệu, hướng phát triển tiếp theo của đề tài là nâng cấp lên **Consistent Hashing (Vòng băm nhất quán với Virtual Nodes)** để chỉ phải di chuyển tối thiểu $1/(N+1)$ dữ liệu khi bổ sung Shard."*

---

### Câu hỏi 4: "Nếu 1 Shard bị sập (Single Node Failure) thì toàn bộ hệ thống có bị chết theo không?"
- **Trả lời**:  
  > *"Thưa thầy/cô, nhờ mô hình **Dedicated Connection Pooling** mà em đã thiết kế, mỗi Shard sở hữu một Connection Pool hoàn toàn biệt lập:  
  > 1. Nếu Shard 2 bị sập, các yêu cầu ghi/đọc định tuyến vào Shard 0 và Shard 1 vẫn hoạt động hoàn toàn bình thường (không bị hiện tượng nghẽn dây chuyền Cascading Failure hay Thread Starvation).  
  > 2. Đối với Shard bị sập, trong thực tế sản xuất, mỗi node Shard này sẽ là một cụm **Primary-Replica (HA Cluster)** có tính năng tự động chuyển vùng dự phòng (Automatic Failover) qua Orchestrator để khôi phục dịch vụ trong vài giây."*

---

### Câu hỏi 5: "Làm thế nào để hạn chế nhược điểm của truy vấn xuyên phân mảnh (Scatter-Gather)?"
- **Trả lời**:  
  > *"Thưa thầy/cô, truy vấn Scatter-Gather như tìm kiếm theo email phải phát tán tới tất cả các Shard, làm tăng hệ số khuếch đại tải và chịu rủi ro độ trễ đuôi (Tail Latency). Để hạn chế trong thực tế:  
  > 1. Thiết kế **Dữ liệu đồng vị trí (Colocation)**: Ví dụ bảng `orders` dùng chung Sharding Key `user_id` với `users` để triệt tiêu Cross-Shard JOIN.  
  > 2. Áp dụng **Global Secondary Index (GSI)**: Sử dụng Redis lưu cặp `email -> user_id`. Khi người dùng tìm theo email, hệ thống chỉ mất $<1$ms tra Redis lấy `user_id`, sau đó định tuyến điểm $O(1)$ đến chính xác Shard đích mà không cần Scatter-Gather."*

---

## 7. CHECKLIST VÀ KỊCH BẢN DEMO TRỰC TIẾP (LIVE DEMO SCRIPT)

Chuẩn bị trước buổi bảo vệ: Mở sẵn **3 cửa sổ Terminal (PowerShell)**.

### Bước 1: Khởi động Cụm Cơ sở dữ liệu (Terminal 1)
```bash
# Di chuyển vào thư mục dự án
cd d:\ChuyenDeKyThuatPhanMem

# Khởi động 3 container MySQL Shards
docker compose up -d

# Xác nhận cả 3 node đang ở trạng thái UP / Healthy
docker compose ps
```

### Bước 2: Chạy Kiểm thử Tự động Thuật toán Snowflake & Router (Terminal 2)
```bash
cd d:\ChuyenDeKyThuatPhanMem\middleware

# Chạy test suite nghiệm thu thuật toán
npm test
```
*Điểm cần nói khi màn hình hiện kết quả*:
- *"Hệ thống vừa sinh thử nghiệm 20,000 ID chỉ trong 13 ms, thông lượng hơn 1.5 triệu ID/giây, không trùng lặp và đơn điệu tăng."*
- *"Hàm băm CRC32 chia 20,000 bản ghi vào 3 Shard với độ lệch chỉ 1.16%, chứng minh tính đồng đều tuyệt đối."*

### Bước 3: Khởi động Middleware và Demo REST API (Terminal 2 & 3)
```bash
# Tại Terminal 2: Chạy Server
npm start
```

Tại Terminal 3, thực hiện lần lượt các lệnh `curl`:

1. **Kiểm tra sức khỏe cụm Shards**:
   ```bash
   curl -X GET http://localhost:3000/api/health
   ```
   $\implies$ Giải thích: Cả 3 Shard đều báo trạng thái `UP`.

2. **Demo Point Insert (Ghi dữ liệu có phân mảnh)**:
   ```bash
   curl -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d "{\"username\": \"sinhvien_k20\", \"email\": \"k20@hcmut.edu.vn\", \"full_name\": \"Nguyen Van Demo\"}"
   ```
   $\implies$ Giải thích: Middleware tự sinh Snowflake ID 64-bit và tự động băm định tuyến vào đúng Shard đích (ví dụ Shard 2).

3. **Demo Point Query (Đọc dữ liệu định tuyến $O(1)$)**:
   ```bash
   # Dùng ID trả về từ lệnh trên
   curl -X GET http://localhost:3000/api/users/<USER_ID_O_TREN>
   ```
   $\implies$ Giải thích: Middleware trích xuất ID, băm ra ngay Shard 2 và chỉ truy vấn đúng 1 Shard duy nhất, độ phức tạp $O(1)$.

4. **Demo Scatter-Gather (Tìm kiếm toàn cục theo Email)**:
   ```bash
   curl -X GET "http://localhost:3000/api/users/search/by-email?email=k20@hcmut.edu.vn"
   ```
   $\implies$ Giải thích: Hệ thống kích hoạt `Promise.all()` phát tán song song đến cả 3 Shard, hiển thị telemetry thời gian phản hồi của từng Shard độc lập.
