export const deltaExpression = `WITH ordered AS (
  SELECT
    m.*,
    c.problem_id,
    c.taken_at,
    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at) AS rn
  FROM measurements m
  JOIN captures c ON c.id = m.capture_id
)
SELECT
  cur.problem_id,
  prev.capture_id AS from_capture_id,
  cur.capture_id  AS to_capture_id,
  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) * 100
  END AS area_change_pct,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE cur.width_mm - prev.width_mm
  END AS width_change_mm,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN 'unknown'
    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) > 0.10 THEN 'growing'
    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) < -0.10 THEN 'shrinking'
    ELSE 'stable'
  END AS growth
FROM ordered cur
JOIN ordered prev
  ON prev.problem_id = cur.problem_id
 AND prev.rn = cur.rn - 1`;
