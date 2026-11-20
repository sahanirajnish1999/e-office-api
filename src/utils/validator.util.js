import mongoose from 'mongoose';

/**
 * Validates email format according to standard RFC-compliant pattern
 * Supports modern TLDs (.org, .co.in, .email, etc.)
 */
export const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);
};

/**
 * Trims and converts email to lowercase
 */
export const normalizeEmail = (email) => {
  return (email || '').trim().toLowerCase();
};

/**
 * Validates phone number format
 * Accepts standard 10-digit mobile numbers (6-9 start) and international E.164 formats (+91, +1, etc.)
 * Strips whitespace, hyphens, and parentheses before checking
 */
export const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.trim().replace(/[\s().-]/g, '');
  if (!cleaned) return false;
  // Accepts:
  // - 10-digit mobile (starting with 6, 7, 8, or 9): e.g. 9876543210
  // - International with country code: e.g. +919876543210, +12025550123 (10 to 15 digits total)
  return /^(\+?[1-9]\d{0,3})?[6-9]\d{9}$/.test(cleaned) || /^\+[1-9]\d{9,14}$/.test(cleaned);
};

/**
 * Normalizes phone number by removing spaces, hyphens, and parentheses
 */
export const normalizePhone = (phone) => {
  return (phone || '').trim().replace(/[\s().-]/g, '');
};

/**
 * Validates whether a value is a valid 24-character hexadecimal MongoDB ObjectId
 */
export const isValidObjectId = (id) => {
  if (!id) return false;
  if (typeof id === 'object' && id instanceof mongoose.Types.ObjectId) return true;
  if (typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
};

export default {
  isValidEmail,
  normalizeEmail,
  isValidPhone,
  normalizePhone,
  isValidObjectId,
};
