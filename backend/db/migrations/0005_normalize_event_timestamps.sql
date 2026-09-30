-- Google may return RFC 3339 datetimes with a numeric UTC offset, while NVCAL
-- stores all event timestamps in canonical UTC ISO-8601 form for EventSchema.
-- Date-only all-day values become midnight UTC; `is_all_day` retains that fact.

UPDATE events
SET
    start_time = strftime('%Y-%m-%dT%H:%M:%fZ', start_time),
    end_time = strftime('%Y-%m-%dT%H:%M:%fZ', end_time)
WHERE
    strftime('%Y-%m-%dT%H:%M:%fZ', start_time) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', end_time) IS NOT NULL;
