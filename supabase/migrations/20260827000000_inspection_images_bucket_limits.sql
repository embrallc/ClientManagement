-- Codify the inspection-images bucket size + MIME limits (was dashboard-only).
--
-- A 10 MB per-object cap and an image-only MIME allowlist were set by hand on the
-- PROD bucket via the Supabase dashboard, so they never lived in a migration —
-- meaning STAGING (and any fresh/rebuilt project) had NO cap and NO type
-- restriction. This makes the migration the source of truth, exactly like
-- 20260623000000 did for the bucket's existence.
--
-- Enforced at the Storage layer (independent of the path-based RLS): an upload
-- over 10 MB or with a non-image content-type is rejected outright. The client
-- always downscales + re-encodes to JPEG (utils/inspectionPhotos.js), so this
-- can't block a legitimate upload — it's a backstop against abuse.
--
-- Idempotent: a no-op on prod (already these exact values); applies the limits on
-- staging + fresh projects. The bucket is created in 20260623000000, so it exists.

UPDATE storage.buckets
SET file_size_limit = 10485760, -- 10 MiB
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
WHERE id = 'inspection-images';
