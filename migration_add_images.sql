-- Run this ONCE on your existing database (local MySQL and Aiven) to allow pictures on notices.
-- New databases made from campuspulse_schema_hosted.sql already have it.
ALTER TABLE notices ADD COLUMN image_data MEDIUMBLOB NULL;
