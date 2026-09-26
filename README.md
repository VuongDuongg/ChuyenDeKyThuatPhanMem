# HỆ THỐNG PHÂN MẢNH CƠ SỞ DỮ LIỆU (DATABASE SHARDING SYSTEM)

Đồ án tốt nghiệp: **Thiết kế và hiện thực hóa hệ thống Phân mảnh cơ sở dữ liệu (Database Sharding & Horizontal Partitioning) cho ứng dụng quy mô lớn**.

---

## 📁 Cấu trúc thư mục dự án

```text
ChuyenDeKyThuatPhanMem/
│── docker-compose.yml           # Khởi tạo cụm 3 Node MySQL Shard (3307, 3308, 3309)
│── PHASE_1_ARCHITECTURE.md     # Tài liệu thiết kế chi tiết (Phase 1) cho báo cáo đồ án
│── README.md                   # Hướng dẫn chạy và tổng quan dự án
└── init-scripts/
    └── 01_init_schema.sql       # Script DDL tự động tạo bảng (users, orders) khi shard khởi chạy
```

---

## 🚀 Hướng dẫn khởi chạy cụm Shards (Docker)

### 1. Yêu cầu môi trường
- Cài đặt **Docker Desktop** (bật tính năng WSL 2 backend trên Windows).
- Khởi động Docker Desktop trước khi chạy lệnh.

### 2. Khởi chạy 3 Shard MySQL
Mở PowerShell hoặc Command Prompt tại thư mục dự án và chạy:

```bash
docker compose up -d
```

### 3. Kiểm tra trạng thái các node
```bash
docker compose ps
```

Sau khoảng 20-30 giây, cả 3 node sẽ chuyển sang trạng thái `healthy`:
- **Shard 0**: `localhost:3307`
- **Shard 1**: `localhost:3308`
- **Shard 2**: `localhost:3309`

### 4. Kết nối kiểm tra dữ liệu bằng MySQL Client hoặc DBeaver / Navicat
- **Host**: `127.0.0.1`
- **Port**: `3307` (Shard 0) | `3308` (Shard 1) | `3309` (Shard 2)
- **Database**: `ecommerce_db`
- **User / Password**: `shard_user` / `shard_user_pass` (hoặc `root` / `root_secret_pass`)
