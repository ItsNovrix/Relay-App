import { reddit, redis, settings } from "@devvit/web/server";
import { lt } from "semver";
import json2md from "json2md";

interface AppUpdate {
    appname: string;
    version: string;
    whatsNewBullets: string[];
}

const UPDATE_SUBREDDIT = "novrixapps";
const UPDATE_WIKI_PAGE = "upgrade-notifier";
const CURRENT_APP_VERSION = "1.1.1";

export async function getNewVersionInfo(appSlug: string): Promise<AppUpdate | undefined> {
    let wikiPage;
    try {
        wikiPage = await reddit.getWikiPage(UPDATE_SUBREDDIT, UPDATE_WIKI_PAGE, { wikiVersion: 'v2' });
    } catch (error) { 
        console.error(`Update Checker: Error getting wiki page ${UPDATE_WIKI_PAGE} from r/${UPDATE_SUBREDDIT}`);
        console.error("EXACT ERROR DETAILS:", error); 
        return;
    }

    const cleanContent = wikiPage.content
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .replace(/\\\{/g, '{')
        .replace(/\\\}/g, '}')
        .replace(/\\"/g, '"');

    const updates = JSON.parse(cleanContent) as AppUpdate[];
    const updatesForThisApp = updates.filter(update => update.appname === appSlug);
    
    if (updatesForThisApp.length === 0) return;
    if (updatesForThisApp.length > 1) {
        console.error(`Update Checker: Multiple updates found for app ${appSlug}`);
        return;
    }

    const update = updatesForThisApp[0];

    if (!lt(CURRENT_APP_VERSION, update.version)) {
        return;
    }

    return update;
}

export async function checkForUpdates() {
    console.log("Update Checker: Waking up to check for updates...");
    try {
        const notificationsEnabled = await settings.get('enable_update_notifications');
        if (notificationsEnabled === false) {
            console.log("Update Checker: Notifications disabled by subreddit. Going back to sleep.");
            return;
        }
        const subreddit = await reddit.getCurrentSubreddit();
        const appUser = await reddit.getAppUser();
        const appSlug = appUser?.username ?? "relay-app";

        const update = await getNewVersionInfo(appSlug);
        if (!update) return;

        const redisKey = "update-notification-sent";
        const notificationSent = await redis.get(redisKey);
        
        if (notificationSent === update.version) {
            return;
        }

        await redis.set(redisKey, update.version);

        const message: json2md.DataObject[] = [
            { p: `A new version of **${appSlug}** (v${update.version}) is available to install!` }
        ];
        
        if (update.whatsNewBullets && update.whatsNewBullets.length > 0) {
            message.push({ p: "**Here's what's new:**" });
            message.push({ ul: update.whatsNewBullets });
        }

        message.push({ 
            p: `To install this update, visit the **[${appSlug} Configuration Page](https://developers.reddit.com/r/${subreddit.name}/apps/${appSlug})** for r/${subreddit.name}.` 
        });

        await reddit.modMail.createModNotification({
            subredditId: subreddit.id,
            subject: `New ${appSlug} Update Available: v${update.version}`,
            bodyMarkdown: json2md(message),
        });

        console.log(`Update Checker: Notification sent for version ${update.version}`);

    } catch (error) {
        console.error("Error in update checker:", error);
    }
}