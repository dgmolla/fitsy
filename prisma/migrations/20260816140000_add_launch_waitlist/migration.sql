-- Launch waitlist: out-of-area users we email when Fitsy reaches their city.
CREATE TABLE "LaunchWaitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    CONSTRAINT "LaunchWaitlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LaunchWaitlist_userId_key" ON "LaunchWaitlist"("userId");
CREATE INDEX "LaunchWaitlist_notifiedAt_idx" ON "LaunchWaitlist"("notifiedAt");
CREATE INDEX "LaunchWaitlist_lat_lng_idx" ON "LaunchWaitlist"("lat", "lng");
ALTER TABLE "LaunchWaitlist" ADD CONSTRAINT "LaunchWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
