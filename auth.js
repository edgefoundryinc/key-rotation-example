/**
 * Authentication Utilities
 * ========================
 * 
 * Simple API key authentication for protected endpoints.
 * Keys are stored as Cloudflare secrets (environment variables).
 * 
 * @module auth
 * @version 1.0.0
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * MODULE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * EXPORTS:
 *   - validateApiKey          : Pure function - validate key against expected
 *   - extractApiKey           : Pure function - extract key from request headers
 *   - createAuthError         : Pure function - create standardized auth error response
 *   - AUTH_HEADER_NAME        : Constant - header name for API key
 *   - AUTH_ERROR_CODES        : Constant - standardized error codes
 *   - selfTest                : Pure function - self-validation with fake inputs
 * 
 * REQUIRED INPUTS:
 *   @typedef {Object} AuthConfig
 *   @property {string} expectedKey - The valid API key (from env.ADMIN_API_KEY)
 * 
 * EXPECTED OUTPUTS:
 *   @typedef {Object} AuthResult
 *   @property {boolean} valid      - Whether authentication passed
 *   @property {string|null} error  - Error message if invalid
 *   @property {string|null} code   - Error code if invalid
 * 
 * SIDE EFFECTS:
 *   - None. All functions are pure.
 * 
 * SECURITY NOTES:
 *   - API keys should be stored as Cloudflare secrets (wrangler secret put)
 *   - Keys are compared using timing-safe comparison to prevent timing attacks
 *   - Never log or expose API keys in responses
 * 
 * USAGE:
 *   1. Set secret: npx wrangler secret put ADMIN_API_KEY
 *   2. In handler: const auth = validateRequest(request, env.ADMIN_API_KEY)
 *   3. If !auth.valid, return createAuthError(auth.code)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Header name for API key authentication
 * Client sends: X-API-Key: <key>
 */
const AUTH_HEADER_NAME = 'X-API-Key';

/**
 * Alternative header (some clients prefer Authorization)
 * Client sends: Authorization: Bearer <key>
 */
const AUTH_HEADER_BEARER = 'Authorization';

/**
 * Standardized error codes for auth failures
 */
const AUTH_ERROR_CODES = {
	MISSING_KEY: 'AUTH_MISSING_KEY',
	INVALID_KEY: 'AUTH_INVALID_KEY',
	MALFORMED_HEADER: 'AUTH_MALFORMED_HEADER'
};

// ═══════════════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if equal
 */
function timingSafeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') {
		return false;
	}
	
	if (a.length !== b.length) {
		// Still do comparison to maintain constant time
		b = a;
	}
	
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	
	return result === 0 && a.length === b.length;
}

/**
 * Extract API key from request headers
 * Supports both X-API-Key and Authorization: Bearer formats
 * @param {Request} request - Incoming request
 * @returns {{key: string|null, source: string|null}}
 */
function extractApiKey(request) {
	if (!request || !request.headers) {
		return { key: null, source: null };
	}
	
	// Try X-API-Key header first
	const xApiKey = request.headers.get(AUTH_HEADER_NAME);
	if (xApiKey && typeof xApiKey === 'string' && xApiKey.trim()) {
		return { key: xApiKey.trim(), source: AUTH_HEADER_NAME };
	}
	
	// Try Authorization: Bearer <key>
	const authHeader = request.headers.get(AUTH_HEADER_BEARER);
	if (authHeader && typeof authHeader === 'string') {
		const parts = authHeader.split(' ');
		if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1].trim()) {
			return { key: parts[1].trim(), source: AUTH_HEADER_BEARER };
		}
	}
	
	return { key: null, source: null };
}

/**
 * Validate API key against expected value
 * @param {string|null} providedKey - Key from request
 * @param {string|null} expectedKey - Expected key from environment
 * @returns {AuthResult}
 */
function validateApiKey(providedKey, expectedKey) {
	// Check if server has a key configured
	if (!expectedKey || typeof expectedKey !== 'string' || expectedKey.length === 0) {
		// No key configured = endpoint is open (development mode)
		// In production, this should be treated as misconfiguration
		return {
			valid: true,
			error: null,
			code: null,
			warning: 'No API key configured - endpoint is unprotected'
		};
	}
	
	// Check if client provided a key
	if (!providedKey || typeof providedKey !== 'string' || providedKey.length === 0) {
		return {
			valid: false,
			error: 'API key required. Provide via X-API-Key header or Authorization: Bearer <key>',
			code: AUTH_ERROR_CODES.MISSING_KEY
		};
	}
	
	// Validate key using timing-safe comparison
	if (!timingSafeEqual(providedKey, expectedKey)) {
		return {
			valid: false,
			error: 'Invalid API key',
			code: AUTH_ERROR_CODES.INVALID_KEY
		};
	}
	
	return {
		valid: true,
		error: null,
		code: null
	};
}

/**
 * Full request validation - extract and validate in one step
 * @param {Request} request - Incoming request
 * @param {string|null} expectedKey - Expected key from env.ADMIN_API_KEY
 * @returns {AuthResult}
 */
function validateRequest(request, expectedKey) {
	const { key } = extractApiKey(request);
	return validateApiKey(key, expectedKey);
}

/**
 * Create standardized auth error response
 * @param {string} code - Error code from AUTH_ERROR_CODES
 * @param {string} [message] - Optional custom message
 * @returns {Response}
 */
function createAuthError(code, message) {
	const status = code === AUTH_ERROR_CODES.MISSING_KEY ? 401 : 403;
	
	const body = {
		success: false,
		error: message || (code === AUTH_ERROR_CODES.MISSING_KEY 
			? 'Authentication required' 
			: 'Access denied'),
		code: code
	};
	
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'WWW-Authenticate': 'Bearer realm="admin"',
			'Access-Control-Allow-Origin': '*'
		}
	});
}

/**
 * Self-test with fake inputs - no external dependencies
 * @returns {{pass: boolean, results: Object}}
 */
function selfTest() {
	const results = {
		timingSafeEqual: { pass: false },
		extractApiKey: { pass: false },
		validateApiKey_valid: { pass: false },
		validateApiKey_invalid: { pass: false },
		validateApiKey_missing: { pass: false },
		validateRequest: { pass: false }
	};
	
	// Test 1: Timing-safe comparison
	results.timingSafeEqual.pass = 
		timingSafeEqual('abc123', 'abc123') === true &&
		timingSafeEqual('abc123', 'abc124') === false &&
		timingSafeEqual('abc', 'abcdef') === false &&
		timingSafeEqual(null, 'abc') === false;
	
	// Test 2: Extract API key from headers
	const mockRequest1 = {
		headers: new Map([['X-API-Key', 'test-key-123']])
	};
	mockRequest1.headers.get = (name) => mockRequest1.headers.get(name);
	// Simplified mock
	const fakeHeaders = { 'x-api-key': 'test-key-123' };
	const mockReq = { headers: { get: (n) => fakeHeaders[n.toLowerCase()] || null } };
	const extracted = extractApiKey(mockReq);
	results.extractApiKey.pass = extracted.key === 'test-key-123';
	results.extractApiKey.details = extracted;
	
	// Test 3: Valid key
	const validResult = validateApiKey('secret-key', 'secret-key');
	results.validateApiKey_valid.pass = validResult.valid === true && validResult.error === null;
	
	// Test 4: Invalid key
	const invalidResult = validateApiKey('wrong-key', 'secret-key');
	results.validateApiKey_invalid.pass = invalidResult.valid === false && invalidResult.code === AUTH_ERROR_CODES.INVALID_KEY;
	
	// Test 5: Missing key
	const missingResult = validateApiKey(null, 'secret-key');
	results.validateApiKey_missing.pass = missingResult.valid === false && missingResult.code === AUTH_ERROR_CODES.MISSING_KEY;
	
	// Test 6: Full request validation
	const mockReq2 = { headers: { get: (n) => n.toLowerCase() === 'x-api-key' ? 'correct-key' : null } };
	const reqResult = validateRequest(mockReq2, 'correct-key');
	results.validateRequest.pass = reqResult.valid === true;
	
	const allPass = Object.values(results).every(r => r.pass);
	
	return { pass: allPass, results };
}

export {
	AUTH_HEADER_NAME,
	AUTH_HEADER_BEARER,
	AUTH_ERROR_CODES,
	extractApiKey,
	validateApiKey,
	validateRequest,
	createAuthError,
	timingSafeEqual,
	selfTest
};
