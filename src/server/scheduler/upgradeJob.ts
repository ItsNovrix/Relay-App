import type { Context } from 'hono';
import { checkForUpdates } from '../upgradeNotifier.js';

export const handleUpgradeCheckJob = async (c: Context) => {
    await checkForUpdates();
    return c.json({ success: true });
};