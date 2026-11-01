-- CampusPulse: schema for a HOSTED MySQL database (Aiven, etc.)
-- Run this inside the database your host gave you (for Aiven it is called defaultdb).
-- It creates the tables, the lists, and ONE admin account (admin@campus.edu).
-- After running it, set the admin password with:  node setup-passwords.js "YourStrongPassword"

-- CampusPulse: Smart Campus Communication Platform
-- MySQL 8.0+ schema with sample data


-- 1. Departments
CREATE TABLE departments (
  department_id INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  code          VARCHAR(10)  NOT NULL UNIQUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users (admin, faculty, student)
CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,            -- bcrypt hash, never plain text
  role          ENUM('admin','faculty','student') NOT NULL,
  department_id INT NULL,
  course        VARCHAR(50)  NULL,                -- students, e.g. 'B.E. CSE'
  year_of_study TINYINT      NULL,                -- students, 1 to 4
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL,
  INDEX idx_users_role (role)
);

-- 3. Categories
CREATE TABLE categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE
);

-- 4. Notices (draft -> pending -> published / rejected -> archived)
CREATE TABLE notices (
  notice_id     INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  category_id   INT NOT NULL,
  department_id INT NULL,                          -- owning department; NULL = campus-wide
  created_by    INT NOT NULL,
  approved_by   INT NULL,
  status        ENUM('draft','pending','published','rejected','archived') NOT NULL DEFAULT 'pending',
  attachment_url VARCHAR(255) NULL,                -- cloud or local file path
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  publish_at    DATETIME NULL,
  expires_at    DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id)   REFERENCES categories(category_id),
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)    REFERENCES users(user_id),
  FOREIGN KEY (approved_by)   REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_notices_status (status, publish_at),
  FULLTEXT INDEX ft_notices (title, body)          -- powers search
);

-- 5. Notice audience (who should see a notice: department, course, year)
CREATE TABLE notice_audience (
  audience_id   INT AUTO_INCREMENT PRIMARY KEY,
  notice_id     INT NOT NULL,
  department_id INT NULL,                          -- NULL = any department
  course        VARCHAR(50) NULL,                  -- NULL = any course
  year_of_study TINYINT NULL,                      -- NULL = any year
  FOREIGN KEY (notice_id)     REFERENCES notices(notice_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE
);

-- 6. Events (workshops, seminars, etc.)
CREATE TABLE events (
  event_id      INT AUTO_INCREMENT PRIMARY KEY,
  notice_id     INT NULL,                          -- linked announcement, if any
  title         VARCHAR(200) NOT NULL,
  description   TEXT NULL,
  venue         VARCHAR(150) NOT NULL,
  starts_at     DATETIME NOT NULL,
  ends_at       DATETIME NULL,
  capacity      INT NULL,                          -- NULL = unlimited
  department_id INT NULL,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (notice_id)     REFERENCES notices(notice_id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)    REFERENCES users(user_id),
  INDEX idx_events_start (starts_at)
);

-- 7. Event registrations (student responses)
CREATE TABLE event_registrations (
  registration_id INT AUTO_INCREMENT PRIMARY KEY,
  event_id        INT NOT NULL,
  user_id         INT NOT NULL,
  status          ENUM('registered','cancelled','attended') NOT NULL DEFAULT 'registered',
  registered_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_user (event_id, user_id),    -- one registration per student
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(user_id)  ON DELETE CASCADE
);

-- 8. Notifications (in-app and email)
CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  notice_id       INT NULL,
  message         VARCHAR(255) NOT NULL,
  channel         ENUM('in_app','email') NOT NULL DEFAULT 'in_app',
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)   REFERENCES users(user_id)     ON DELETE CASCADE,
  FOREIGN KEY (notice_id) REFERENCES notices(notice_id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
);

-- 9. Notice views (feeds the Analytics & Reports module)
CREATE TABLE notice_views (
  view_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  notice_id INT NOT NULL,
  user_id   INT NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_view (notice_id, user_id),
  FOREIGN KEY (notice_id) REFERENCES notices(notice_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(user_id)     ON DELETE CASCADE
);

-- 10. Audit logs (who did what, and when)
CREATE TABLE audit_logs (
  log_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  action      VARCHAR(50) NOT NULL,                -- e.g. 'CREATE_NOTICE', 'APPROVE_NOTICE'
  entity_type VARCHAR(50) NOT NULL,                -- e.g. 'notice'
  entity_id   INT NULL,
  details     JSON NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id)
);


-- ============================================================
-- STARTER DATA (no sample notices, one admin only)
-- ============================================================
INSERT INTO departments (name, code) VALUES
 ('Computer Science','CSE'), ('Mechanical','MECH'), ('Electronics','ECE'),
 ('Library','LIB'), ('Administration','ADM');

INSERT INTO categories (name) VALUES ('General'), ('Exam'), ('Event'), ('Placement');

-- placeholder hash: the real password is set by setup-passwords.js
INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES
 ('Campus Admin', 'admin@campus.edu', '$2b$10$placeholderhash', 'admin', 5);
