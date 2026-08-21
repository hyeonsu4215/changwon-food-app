CREATE TABLE public.restaurant_weekly_hours (
  restaurant_id text NOT NULL,
  iso_weekday smallint NOT NULL,
  day_status text NOT NULL,
  open_time time without time zone NULL,
  close_time time without time zone NULL,
  closes_next_day boolean NOT NULL DEFAULT false,
  break_status text NOT NULL,
  break_start time without time zone NULL,
  break_end time without time zone NULL,
  note text NULL,
  source text NULL,
  last_verified_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_weekly_hours_pkey
    PRIMARY KEY (restaurant_id, iso_weekday),
  CONSTRAINT restaurant_weekly_hours_restaurant_fkey
    FOREIGN KEY (restaurant_id)
    REFERENCES public.restaurants (id)
    ON DELETE RESTRICT,
  CONSTRAINT restaurant_weekly_hours_iso_weekday_allowed
    CHECK (iso_weekday BETWEEN 1 AND 7),
  CONSTRAINT restaurant_weekly_hours_day_status_allowed
    CHECK (day_status IN ('open', 'closed', 'unknown')),
  CONSTRAINT restaurant_weekly_hours_break_status_allowed
    CHECK (break_status IN ('scheduled', 'none', 'unknown')),
  CONSTRAINT restaurant_weekly_hours_day_shape_valid
    CHECK (
      (day_status = 'open' AND open_time IS NOT NULL AND close_time IS NOT NULL)
      OR
      (
        day_status = 'closed'
        AND open_time IS NULL
        AND close_time IS NULL
        AND closes_next_day = false
        AND break_status = 'none'
      )
      OR
      (
        day_status = 'unknown'
        AND open_time IS NULL
        AND close_time IS NULL
        AND closes_next_day = false
        AND break_status = 'unknown'
      )
    ),
  CONSTRAINT restaurant_weekly_hours_break_shape_valid
    CHECK (
      (
        break_status = 'scheduled'
        AND day_status = 'open'
        AND break_start IS NOT NULL
        AND break_end IS NOT NULL
      )
      OR
      (
        break_status IN ('none', 'unknown')
        AND break_start IS NULL
        AND break_end IS NULL
      )
    )
);

ALTER TABLE public.restaurant_weekly_hours ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.restaurant_weekly_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_weekly_hours TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.restaurant_weekly_hours TO authenticated;

CREATE POLICY "Active restaurant weekly hours are readable by everyone"
ON public.restaurant_weekly_hours
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.restaurants AS restaurant
    WHERE restaurant.id = restaurant_weekly_hours.restaurant_id
      AND restaurant.active = true
  )
);

CREATE POLICY "Admins can manage restaurant weekly hours"
ON public.restaurant_weekly_hours
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE TRIGGER restaurant_weekly_hours_updated_at
BEFORE UPDATE ON public.restaurant_weekly_hours
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
