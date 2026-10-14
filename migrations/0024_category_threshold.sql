-- Category confidence threshold moved from 0.90 to 0.60. predicted_category is
-- always stored, so existing analyses are re-derived without calling SubQ.
UPDATE email_analysis
SET category = predicted_category
WHERE category IS NULL AND confidence >= 0.60;

UPDATE email_analysis
SET review = CASE WHEN phishing = 1 OR spam = 1 OR category IS NULL THEN 1 ELSE 0 END
WHERE confidence >= 0.60;
