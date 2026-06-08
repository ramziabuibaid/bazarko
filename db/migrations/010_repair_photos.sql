-- 010_repair_photos.sql
-- صور الجهاز في مراحل مختلفة (استلام، تشخيص، جاهز، تسليم)
SET search_path = public;

ALTER TABLE repair_jobs
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;
