// Runs in every test worker BEFORE app modules are imported.
const base = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mohalla_test?schema=public';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = base;
process.env.OTP_PROVIDER = 'dev';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-0123456789';
process.env.OTP_SECRET = 'test-otp-secret-test-otp-secret';
process.env.GPS_CHECKS_REQUIRED = '2';
process.env.GPS_CHECK_MIN_GAP_HOURS = '0';
process.env.VOUCHES_REQUIRED = '2';
process.env.UPLOAD_DRIVER = 'local';
process.env.UPLOAD_DIR = './tests/.uploads';
process.env.PUSH_ENABLED = 'false';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
