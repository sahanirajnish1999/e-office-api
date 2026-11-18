/**
 * Permission Middleware
 * Enforces user-level granular permissions defined in User.permissions
 * Super Admin role automatically bypasses all user-level permission checks.
 */
export const checkPermission = (permissionKey) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Super Admin has unrestricted access across all actions
    if (req.user.role === 'super_admin') {
      return next();
    }

    const permissions = req.user.permissions || {};
    const keys = Array.isArray(permissionKey) ? permissionKey : [permissionKey];

    const hasPermission = keys.every((key) => Boolean(permissions[key]));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have '${keys.join(', ')}' permission`,
      });
    }

    next();
  };
};

export default checkPermission;
