import {
  Devvit,
  Context,
  FormOnSubmitEvent,
  MenuItemOnPressEvent,
  WikiPage,
  WikiPagePermissionLevel,
} from "@devvit/public-api";
import { Paragraph } from "@devvit/shared-types/richtext/types.js";
import {
  isModerator as checkIsMod,
  replacePlaceholders,
  getRecommendedPlaceholdersFromModAction,
  assembleRemovalReason,
  submitPostReply,
  ignoreReportsByPostId,
  setLockByPostId,
  isBanned,
} from "devvit-helpers";

// ==========================================================
// 1. DEVVIT CONFIGURATION
// ==========================================================

Devvit.configure({
  redditAPI: true,
  redis: true,
  modLog: false,
  http: true,
});

// ==========================================================
// 2. SCHEDULED POSTS JOB
// ==========================================================

Devvit.addSchedulerJob({
  name: 'scheduled_post_job',
  onRun: async (event, context) => {
    const { templateNumber } = event.data!;
    const subreddit = await context.reddit.getCurrentSubreddit();
    
// --- FETCH TEMPLATE SETTINGS ---

    const title = await context.settings.get(`postTemplate${templateNumber}title`) as string;
    const body = await context.settings.get(`postTemplate${templateNumber}body`) as string;
    const sticky = await context.settings.get(`postTemplate${templateNumber}Sticky`) as boolean;
    const lock = await context.settings.get(`postTemplate${templateNumber}Lock`) as boolean;

    // --- TOGGLES FOR POST CLEANUP (UNSTICKY/LOCK PREVIOUS POST) ---

    const autoUnsticky = await context.settings.get(`postTemplate${templateNumber}AutoUnsticky`) as boolean;
    const autoLock = await context.settings.get(`postTemplate${templateNumber}AutoLock`) as boolean;

    if (!title) return;

// --- CLEANUP PREVIOUS POST ---

    const redisKey = `last_post_id_template_${templateNumber}`;
    const lastPostId = await context.redis.get(redisKey);

    if (lastPostId && (autoUnsticky || autoLock)) {
      try {
        const oldPost = await context.reddit.getPostById(lastPostId);
        if (autoUnsticky) await oldPost.unsticky();
        if (autoLock) await oldPost.lock();
        console.log(`Cleaned up previous post ${lastPostId} for Template ${templateNumber}`);
      } catch (e) {
        console.log(`Cleanup skipped: Previous post ${lastPostId} not found or already handled.`);
      }
    }

    const post = await context.reddit.submitPost({
      subredditName: subreddit.name,
      title: title,
      text: body,
    });

    // --- SAVE NEW POST ID FOR NEXT RUN'S CLEANUP ---
    
    await context.redis.set(redisKey, post.id);

    await post.distinguish();
    if (sticky) await post.sticky();
    if (lock) await post.lock();

    console.log(`Scheduled Template ${templateNumber} posted successfully!`);

// --- RESCHEDULE OR CANCEL JOB ---

    const repeatWeekly = await context.settings.get(`postTemplate${templateNumber}Repeat`) as boolean;
    const monthly = await context.settings.get(`postTemplate${templateNumber}Monthly`) as boolean;
    const monthDay = await context.settings.get(`postTemplate${templateNumber}MonthDay`) as number;
    const hour = await context.settings.get(`postTemplate${templateNumber}Hour`) as number;
    const minute = await context.settings.get(`postTemplate${templateNumber}Minute`) as number;

// --- HELPER FUNCTION TO GET MONTHLY CRON EXPRESSION ---

    if (monthly) {
      const nextMonthDate = new Date();
      nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);

      const nextCron = getMonthlyCron(monthDay, hour, minute, nextMonthDate);

      await context.scheduler.runJob({
        name: 'scheduled_post_job',
        cron: nextCron,
        data: { templateNumber },
      });

      console.log(`Monthly Template ${templateNumber} rescheduled for next month.`);
    }

    const repeat = await context.settings.get(
      `postTemplate${templateNumber}Repeat`
    ) as boolean;

    const scheduledEvent = event as any;
    if (!repeatWeekly && !monthly && scheduledEvent.job?.id) {
      await context.scheduler.cancelJob(scheduledEvent.job.id);
    }
  },
});

// ==========================================================
// 3. SETTINGS & CONFIG
// ==========================================================

Devvit.addSettings([
  
  // --- NOTIFICATION SETTINGS ---

    {
    type: "group",
    label: "Relay App Notifications",
    fields: [
      {
        type: "boolean",
        name: "notify_on_posts",
        label: "Notify on Post Replies",
        helpText: `Choose this if you'd like to receive Modmail notifications when users reply to posts or comments made via Relay App.`,
        defaultValue: false,
      },
      {
        type: "boolean",
        name: "notify_on_comments",
        label: "Notify on Comment Replies",
        helpText: `Choose this if you'd like to receive Modmail notifications when users reply to comments made via Relay App.`,
        defaultValue: false,
      },
      {
        type: "boolean",
        name: "notify_ignore_mods",
        label: "Ignore replies from moderators",
        helpText: `Choose this if you'd like to ignore replies from moderators when sending notifications.`,
        defaultValue: true,
      },
            {
        type: "string",
        name: "notify_extra_users",
        label: "Also notify for these specified Users (comma-separated, not case-sensitive)",
        helpText: `Optionally specify additional usernames to be notified of replies (e.g., AutoModerator). Omit the leading /u/.`,
      },
    ],
  },

  // --- PUBLISH/EDIT NOTIFICATION SETTINGS ---

  {
    type: "group",
    label: "Publish/Edit Notifications",
    fields: [
        {
        type: "boolean",
        name: "sendModmail",
        label: "Send to Modmail?",
        helpText: `Choose this if you'd like to receive a copy of each Relay App publish and edit in Modmail.`,
        defaultValue: false,
      },
      {
        type: "boolean",
        name: "sendDiscord",
        label: "Send to Discord?",
        helpText: `Choose this if you'd like to receive notifications of each Relay App publish and edit on your Discord server via webhook. Very long posts may be truncated by Discord.`,
        defaultValue: false,
      },
      {
        type: "string",
        name: "webhookEditor",
        label: "Webhook URL",
        helpText: `Paste your Discord webhook URL (Server Settings → Integrations → Webhooks).`,
      },
      {
        type: "string",
        name: "discordRole",
        label: "Role ID to ping",
        helpText: `Optional: paste the role ID to @mention (enable "Mentionable" for that role in Discord).`,
      },
    ],
  },
  
  // --- AUTO-FLAIR SETTINGS ---

  {
    type: "group",
    label: "Auto-flair settings",
    fields: [
      {
        name: "setFlairAfterPosting",
        type: "boolean",
        label: `Enable auto-flair after posting?`,
        helpText: `Automatically set the post flair after a Relay App publish.`,
        defaultValue: false,
      },
      {
        type: "string",
        name: "relayAppPostFlairText",
        label: "Flair label to apply on new posts",
        helpText: `Enter the exact flair label to apply.`,
        defaultValue: `Mod Post`,
      },
      {
        name: "setFlairAfterCommenting",
        type: "boolean",
        label: "Enable auto-flair after commenting?",
        helpText: `When a moderator comments via Relay App, automatically update the post flair.`,
        defaultValue: false,
      },
      {
        type: "string",
        name: "relayAppCommentPostFlairText",
        label: "Flair label to apply after mod reply",
        helpText: `Enter the flair label to switch to after a mod replies (e.g., "Mods Replied").`,
        defaultValue: `Mods Replied`,
      },
    ],
  },

  // --- POST TEMPLATE #1 SETTINGS ---

  {
    type: "group",
    label: "Post Template 1",
    fields: [
      {
        name: "postTemplate1name",
        type: "string",
        label: "Template 1 name",
        helpText:
          "Internal name shown only in settings. Not visible to users or in posts",
        defaultValue: "First template",
      },
      {
        name: "postTemplate1title",
        type: "string",
        label: "Template 1 post title",
        helpText:
          "Prefilled title when using this template. Note: post titles can't be edited after publishing.",
      },
      {
        name: "postTemplate1body",
        type: "paragraph",
        label: `Template 1 post body`,
        helpText:
          "Prefilled body (Markdown supported). You can still edit before publishing.",
      },
{
    name: "postTemplate1Enabled",
    type: "boolean",
    label: "Enable scheduling for Template 1?",
    helpText: "Enable this to schedule posts using Template 1.",
    defaultValue: false,
  },
      {
        name: "postTemplate1Repeat",
        type: "boolean",
        label: "Repeat weekly?",
        helpText: "If off, this will only post once at the next scheduled time.",
        defaultValue: false,
      },
      {
        name: "postTemplate1Day",
        type: "select",
        label: "Day of the week",
        options: [
          { label: "Monday", value: "1" },
          { label: "Tuesday", value: "2" },
          { label: "Wednesday", value: "3" },
          { label: "Thursday", value: "4" },
          { label: "Friday", value: "5" },
          { label: "Saturday", value: "6" },
          { label: "Sunday", value: "0" },
        ],
        defaultValue: ["1"],
      },
      {
      name: "postTemplate1Monthly",
      type: "boolean",
      label: "Repeat monthly?",
      helpText: "Enable this to schedule posts monthly instead of weekly.",
      defaultValue: false,
      },
      {
      name: "postTemplate1MonthDay",
      type: "number",
      label: "Day of month (1-31)",
      helpText: "Day of the month the post should go out. If the month has fewer days, the post will be scheduled for the last day of the month.",
      defaultValue: 1,
      },
      {
        name: "postTemplate1Hour",
        type: "number",
        label: "Hour (0-23) UTC",
        helpText: "Use 24-hour format (e.g., 13 = 1 PM, 17 = 5 PM). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate1Minute",
        type: "number",
        label: "Minute (0-59) UTC",
        helpText: "Minute of the hour (0-59). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate1Sticky",
        type: "boolean",
        label: "Sticky the scheduled post?",
        defaultValue: false,
      },
      {
        name: "postTemplate1Lock",
        type: "boolean",
        label: "Lock the scheduled post?",
        defaultValue: false,
      },
      {
      name: 'postTemplate1AutoUnsticky',
      type: 'boolean',
      label: 'Auto-Unsticky the previous post?',
      helpText: 'When a new post from this template is created, should the previous one be unstickied?',
      defaultValue: false,
      },
      {
      name: 'postTemplate1AutoLock',
      type: 'boolean',
      label: 'Auto-Lock the previous post?',
      helpText: 'When unstickying the previous post, should it also be locked?',
      defaultValue: false,
      },
    ],
  },

  // --- POST TEMPLATE #2 SETTINGS ---

  {
    type: "group",
    label: "Post Template 2",
    fields: [
      {
        name: "postTemplate2name",
        type: "string",
        label: "Template 2 name",
        helpText:
          "Internal name shown only in settings. Not visible to users or in posts",
        defaultValue: "Second template",
      },
      {
        name: "postTemplate2title",
        type: "string",
        label: "Template 2 post title",
        helpText:
          "Prefilled title when using this template. Note: post titles can't be edited after publishing.",
      },
      {
        name: "postTemplate2body",
        type: "paragraph",
        label: `Template 2 post body`,
        helpText:
          "Prefilled body (Markdown supported). You can still edit before publishing.",
      },
      {
        name: "postTemplate2Enabled",
        type: "boolean",
        label: "Enable scheduling for Template 2?",
        helpText: "Enable this to schedule posts using Template 2.",
        defaultValue: false,
      },
      {
        name: "postTemplate2Repeat",
        type: "boolean",
        label: "Repeat weekly?",
        helpText: "If off, this will only post once at the next scheduled time.",
        defaultValue: false,
      },
      {
        name: "postTemplate2Day",
        type: "select",
        label: "Day of the week",
        options: [
          { label: "Monday", value: "1" },
          { label: "Tuesday", value: "2" },
          { label: "Wednesday", value: "3" },
          { label: "Thursday", value: "4" },
          { label: "Friday", value: "5" },
          { label: "Saturday", value: "6" },
          { label: "Sunday", value: "0" },
        ],
        defaultValue: ["1"],
      },
      {
      name: "postTemplate2Monthly",
      type: "boolean",
      label: "Repeat monthly?",
      helpText: "Enable this to schedule posts monthly instead of weekly.",
      defaultValue: false,
      },
      {
      name: "postTemplate2MonthDay",
      type: "number",
      label: "Day of month (1-31)",
      helpText: "Day of the month the post should go out. If the month has fewer days, the post will be scheduled for the last day of the month.",
      defaultValue: 1,
      },
      {
        name: "postTemplate2Hour",
        type: "number",
        label: "Hour (0-23) UTC",
        helpText: "Use 24-hour format (e.g., 13 = 1 PM, 17 = 5 PM). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate2Minute",
        type: "number",
        label: "Minute (0-59) UTC",
        helpText: "Minute of the hour (0-59). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate2Sticky",
        type: "boolean",
        label: "Sticky the scheduled post?",
        defaultValue: false,
      },
      {
        name: "postTemplate2Lock",
        type: "boolean",
        label: "Lock the scheduled post?",
        defaultValue: false,
      },
      {
      name: 'postTemplate2AutoUnsticky',
      type: 'boolean',
      label: 'Auto-Unsticky the previous post?',
      helpText: 'When a new post from this template is created, should the previous one be unstickied?',
      defaultValue: false,
      },
      {
      name: 'postTemplate2AutoLock',
      type: 'boolean',
      label: 'Auto-Lock the previous post?',
      helpText: 'When unstickying the previous post, should it also be locked?',
      defaultValue: false,
      },
    ],
  },

  // --- POST TEMPLATE #3 SETTINGS ---

  {
    type: "group",
    label: "Post Template 3",
    fields: [
      {
        name: "postTemplate3name",
        type: "string",
        label: "Template 3 name",
        helpText:
          "Internal name shown only in settings. Not visible to users or in posts",
        defaultValue: "Third template",
      },
      {
        name: "postTemplate3title",
        type: "string",
        label: "Template 3 post title",
        helpText:
          "Prefilled title when using this template. Note: post titles can't be edited after publishing.",
      },
      {
        name: "postTemplate3body",
        type: "paragraph",
        label: `Template 3 post body`,
        helpText:
          "Prefilled body (Markdown supported). You can still edit before publishing.",
      },
      {
        name: "postTemplate3Enabled",
        type: "boolean",
        label: "Enable scheduling for Template 3?",
        helpText: "Enable this to schedule posts using Template 3.",
        defaultValue: false,
      },
      {
        name: "postTemplate3Repeat",
        type: "boolean",
        label: "Repeat weekly?",
        helpText: "If off, this will only post once at the next scheduled time.",
        defaultValue: false,
      },
      {
        name: "postTemplate3Day",
        type: "select",
        label: "Day of the week",
        options: [
          { label: "Monday", value: "1" },
          { label: "Tuesday", value: "2" },
          { label: "Wednesday", value: "3" },
          { label: "Thursday", value: "4" },
          { label: "Friday", value: "5" },
          { label: "Saturday", value: "6" },
          { label: "Sunday", value: "0" },
        ],
        defaultValue: ["1"],
      },
      {
      name: "postTemplate3Monthly",
      type: "boolean",
      label: "Repeat monthly?",
      helpText: "Enable this to schedule posts monthly instead of weekly.",
      defaultValue: false,
      },
      {
      name: "postTemplate3MonthDay",
      type: "number",
      label: "Day of month (1-31)",
      helpText: "Day of the month the post should go out. If the month has fewer days, the post will be scheduled for the last day of the month.",
      defaultValue: 1,
      },
      {
        name: "postTemplate3Hour",
        type: "number",
        label: "Hour (0-23) UTC",
        helpText: "Use 24-hour format (e.g., 13 = 1 PM, 17 = 5 PM). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate3Minute",
        type: "number",
        label: "Minute (0-59) UTC",
        helpText: "Minute of the hour (0-59). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate3Sticky",
        type: "boolean",
        label: "Sticky the scheduled post?",
        defaultValue: false,
      },
      {
        name: "postTemplate3Lock",
        type: "boolean",
        label: "Lock the scheduled post?",
        defaultValue: false,
      },
      {
      name: 'postTemplate3AutoUnsticky',
      type: 'boolean',
      label: 'Auto-Unsticky the previous post?',
      helpText: 'When a new post from this template is created, should the previous one be unstickied?',
      defaultValue: false,
      },
      {
      name: 'postTemplate3AutoLock',
      type: 'boolean',
      label: 'Auto-Lock the previous post?',
      helpText: 'When unstickying the previous post, should it also be locked?',
      defaultValue: false,
      },
    ],
  },

  // --- POST TEMPLATE #4 SETTINGS ---

  {
    type: "group",
    label: "Post Template 4",
    fields: [
      {
        name: "postTemplate4name",
        type: "string",
        label: "Template 4 name",
        helpText:
          "Internal name shown only in settings. Not visible to users or in posts",
        defaultValue: "Fourth template",
      },
      {
        name: "postTemplate4title",
        type: "string",
        label: "Template 4 post title",
        helpText:
          "Prefilled title when using this template. Note: post titles can't be edited after publishing.",
      },
      {
        name: "postTemplate4body",
        type: "paragraph",
        label: `Template 4 post body`,
        helpText:
          "Prefilled body (Markdown supported). You can still edit before publishing.",
      },
      {
        name: "postTemplate4Enabled",
        type: "boolean",
        label: "Enable scheduling for Template 4?",
        helpText: "Enable this to schedule posts using Template 4.",
        defaultValue: false,
      },
      {
        name: "postTemplate4Repeat",
        type: "boolean",
        label: "Repeat weekly?",
        helpText: "If off, this will only post once at the next scheduled time.",
        defaultValue: false,
      },
      {
        name: "postTemplate4Day",
        type: "select",
        label: "Day of the week",
        options: [
          { label: "Monday", value: "1" },
          { label: "Tuesday", value: "2" },
          { label: "Wednesday", value: "3" },
          { label: "Thursday", value: "4" },
          { label: "Friday", value: "5" },
          { label: "Saturday", value: "6" },
          { label: "Sunday", value: "0" },
        ],
        defaultValue: ["1"],
      },
      {
      name: "postTemplate4Monthly",
      type: "boolean",
      label: "Repeat monthly?",
      helpText: "Enable this to schedule posts monthly instead of weekly.",
      defaultValue: false,
      },
      {
      name: "postTemplate4MonthDay",
      type: "number",
      label: "Day of month (1-31)",
      helpText: "Day of the month the post should go out. If the month has fewer days, the post will be scheduled for the last day of the month.",
      defaultValue: 1,
      },
      {
        name: "postTemplate4Hour",
        type: "number",
        label: "Hour (0-23) UTC",
        helpText: "Use 24-hour format (e.g., 13 = 1 PM, 17 = 5 PM). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate4Minute",
        type: "number",
        label: "Minute (0-59) UTC",
        helpText: "Minute of the hour (0-59). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate4Sticky",
        type: "boolean",
        label: "Sticky the scheduled post?",
        defaultValue: false,
      },
      {
        name: "postTemplate4Lock",
        type: "boolean",
        label: "Lock the scheduled post?",
        defaultValue: false,
      },
      {
      name: 'postTemplate4AutoUnsticky',
      type: 'boolean',
      label: 'Auto-Unsticky the previous post?',
      helpText: 'When a new post from this template is created, should the previous one be unstickied?',
      defaultValue: false,
      },
      {
      name: 'postTemplate4AutoLock',
      type: 'boolean',
      label: 'Auto-Lock the previous post?',
      helpText: 'When unstickying the previous post, should it also be locked?',
      defaultValue: false,
      },
    ],
  },

  // --- POST TEMPLATE #5 SETTINGS ---

  {
    type: "group",
    label: "Post Template 5",
    fields: [
      {
        name: "postTemplate5name",
        type: "string",
        label: "Template 5 name",
        helpText:
          "Internal name shown only in settings. Not visible to users or in posts",
        defaultValue: "Fifth template",
      },
      {
        name: "postTemplate5title",
        type: "string",
        label: "Template 5 post title",
        helpText:
          "Prefilled title when using this template. Note: post titles can't be edited after publishing.",
      },
      {
        name: "postTemplate5body",
        type: "paragraph",
        label: `Template 5 post body`,
        helpText:
          "Prefilled body (Markdown supported). You can still edit before publishing.",
      },
      {
        name: "postTemplate5Enabled",
        type: "boolean",
        label: "Enable scheduling for Template 5?",
        helpText: "Enable this to schedule posts using Template 5.",
        defaultValue: false,
      },
      {
        name: "postTemplate5Repeat",
        type: "boolean",
        label: "Repeat weekly?",
        helpText: "If off, this will only post once at the next scheduled time.",
        defaultValue: false,
      },
      {
        name: "postTemplate5Day",
        type: "select",
        label: "Day of the week",
        options: [
          { label: "Monday", value: "1" },
          { label: "Tuesday", value: "2" },
          { label: "Wednesday", value: "3" },
          { label: "Thursday", value: "4" },
          { label: "Friday", value: "5" },
          { label: "Saturday", value: "6" },
          { label: "Sunday", value: "0" },
        ],
        defaultValue: ["1"],
      },
      {
      name: "postTemplate5Monthly",
      type: "boolean",
      label: "Repeat monthly?",
      helpText: "Enable this to schedule posts monthly instead of weekly.",
      defaultValue: false,
      },
      {
      name: "postTemplate5MonthDay",
      type: "number",
      label: "Day of month (1-31)",
      helpText: "Day of the month the post should go out. If the month has fewer days, the post will be scheduled for the last day of the month.",
      defaultValue: 1,
      },
      {
        name: "postTemplate5Hour",
        type: "number",
        label: "Hour (0-23) UTC",
        helpText: "Use 24-hour format (e.g., 13 = 1 PM, 17 = 5 PM). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate5Minute",
        type: "number",
        label: "Minute (0-59) UTC",
        helpText: "Minute of the hour (0-59). All schedules follow UTC time.",
        defaultValue: 0,
      },
      {
        name: "postTemplate5Sticky",
        type: "boolean",
        label: "Sticky the scheduled post?",
        defaultValue: false,
      },
      {
        name: "postTemplate5Lock",
        type: "boolean",
        label: "Lock the scheduled post?",
        defaultValue: false,
      },
      {
      name: 'postTemplate5AutoUnsticky',
      type: 'boolean',
      label: 'Auto-Unsticky the previous post?',
      helpText: 'When a new post from this template is created, should the previous one be unstickied?',
      defaultValue: false,
      },
      {
      name: 'postTemplate5AutoLock',
      type: 'boolean',
      label: 'Auto-Lock the previous post?',
      helpText: 'When unstickying the previous post, should it also be locked?',
      defaultValue: false,
      },
    ],
  },
]),

// ==========================================================
// 4. TRIGGERS
// ==========================================================

// --- APP INSTALL MESSAGE ---

Devvit.addTrigger({
  event: "AppInstall",
  async onEvent(event, context) {
    console.log(`App installed on r/${event.subreddit?.name}.`);

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = await context.reddit.getAppUser();

    var firstMsg = `Hello r/${subreddit.name} mods,\n\n`;

    ((firstMsg += `Thanks for installing **Relay App**!\n\n`),
      (firstMsg += `Relay App helps your team publish and manage official mod posts and pinned mod comments — fast, consistent, and without shared accounts.\n\n`));

    /* QUICK START */
    ((firstMsg += `**How to use Relay App:**\n\n\n`),
      (firstMsg += `1) Open **Relay App → New Post** or **New Comment**\n`),
      (firstMsg += `2) Write your content, toggle **Sticky** / **Lock** as needed\n`),
      (firstMsg += `3) **Publish** — done!\n\n`),
      (firstMsg += `*Note:* Post titles **cannot be edited** after publishing due to Reddit limitations. Double-check before you post.\n\n`));

    /* DEFAULTS & NOTIFICATIONS */
    ((firstMsg += `**Defaults & notifications:**\n\n\n`),
      (firstMsg += `- An **internal mod note** is added automatically after each publish (shows who posted + direct link).\n`),
      (firstMsg += `- **Reply notifications are OFF by default** but can easily be enabled in the app settings.\n`),
      (firstMsg += `- **Reply notifications only monitor the first 24 hours** after a post/comment is made by Relay App due to Reddit limitations.\n`),
      (firstMsg += `- **Publish/edit notifications are OFF by default** on submit and on edit of a mod post.\n`),
      (firstMsg += `- **Discord notifications** are supported if you add a webhook in settings. Heads-up: very long posts may hit Discord payload limits.\n\n`));

    /* FEATURES */
    ((firstMsg += `**Features you can use today:**\n\n\n`),
      (firstMsg += `- Publish **official mod posts** (text) with one-click **Distinguish**, **Sticky**, and **Lock**.\n`),
      (firstMsg += `- Publish **official mod comments** (also with **Distinguish**, **Sticky**, and **Lock**).\n`),
      (firstMsg += `- **Native Link Posting** — Seamlessly publish native link posts with optional body text.\n`),
      (firstMsg += `- **Native Media Posting** — Seamlessly publish native media posts with optional body text.\n`),
      (firstMsg += `- **Reply notifications** — Receive notifications to modmail when someone replies to a post/comment created by Relay App or other specified mod apps.\n`),
      (firstMsg += `- **Auto-flair after posting** — Automatically apply a flair (e.g., *Mod Post*) to posts created via Relay App.\n`),
      (firstMsg += `- **Auto-flair after commenting** — When a **mod replies via Relay App**, the post flair can auto-switch (e.g., *Mods Replied*).\n`),
      (firstMsg += `- **Post Templates** — Save up to **5** reusable templates per subreddit. Add them in settings, then select **Use template** when creating a post.\n`),
      (firstMsg += `- **Post Scheduling** — Schedule up to **5** post templates to automatically publish at specific times weekly (with optional **Sticky** and **Lock**).\n`),
      (firstMsg += `- **Auto-Unsticky/lock** — Automatically unsticky and/or lock your previous scheduled posts as new ones go live.\n`),
      (firstMsg += `- **Clone Post** — Click **Clone** on any previous post to rapidly reuse it (perfect for monthly stickies & AMA re-runs).\n`),
      (firstMsg += `- **Permanent delete** of posts/comments created via the app (not just remove) — use with care.\n`),
      (firstMsg += `- Permissions required: **Post** or **Everything**.\n\n`));

    /* CONFIG LINKS */
    ((firstMsg += `**Configure now:** manage templates, auto-flair, and Discord settings here → `),
      (firstMsg += `[ Relay App settings](https://developers.reddit.com/r/${subreddit.name}/apps/relay-app)\n\n`));

    /* FOOTER */
    ((firstMsg += `[Terms & Conditions](https://www.reddit.com/r/RelayApp/wiki/terms-and-conditions/) | `),
      (firstMsg += `[Privacy Policy](https://www.reddit.com/r/RelayApp/wiki/privacy-policy/) | `),
      (firstMsg += `[Contact](https://reddit.com/r/RelayApp)\n\n`));

    await context.reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: "relay-app",
      subject: `Thanks for installing Relay App!`,
      text: firstMsg,
    });
    console.log(`Message sent to r/${event.subreddit?.name} mods.`);

    await context.reddit.setUserFlair({
      subredditName: subreddit.name,
      username: appAccount.username,
      text: "Mod Bot 🤖",
      textColor: "light",
      backgroundColor: "#FF0000",
    });
  },
});

// --- APP UPGRADE MESSAGE ---

Devvit.addTrigger({
  event: "AppUpgrade",
  async onEvent(event, context) {
    console.log(`App updated on r/${event.subreddit?.name}.`);

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = await context.reddit.getAppUser();

    var firstMsg = `Hello r/${subreddit.name} mods,\n\n`;

    ((firstMsg += `Thanks for **updating Relay App**!\n\n`),
      (firstMsg += `Relay App helps your team publish and manage official mod posts and mod comments — fast, consistent, and without shared accounts.\n\n`));

    /* WHAT'S NEW */
    ((firstMsg += `**What's new (highlights):**\n\n\n`),
      (firstMsg += `- **Devvit Update** — Relay App has been updated to the latest Devvit release for continued functionality and stability.\n`),

    /* REMINDERS */
    ((firstMsg += `**Good to know / reminders:**\n\n\n`),
      (firstMsg += `- Titles **cannot be edited** after publishing due to Reddit limitations. Double-check before posting.\n\n`),
      (firstMsg += `- An **internal mod note** is automatically added after each publish, showing who posted and linking to the content.\n\n`),
      (firstMsg += `- **Reply notifications are OFF by default** but can easily be enabled in the app settings.\n`),
      (firstMsg += `- **Reply notifications only monitor the first 24 hours** after a post/comment is made by Relay App due to Reddit limitations.\n`),
      (firstMsg += `- **Publish/edit notifications are OFF by default** on submit and on edit of a mod post.\n`),
      (firstMsg += `- **Discord notifications** are supported (add your webhook in settings). Note: very long bodies may hit Discord’s payload limits.\n\n`),
      (firstMsg += `- You can **permanently delete** posts/comments created by the app (not just remove) — use with care.\n\n`),
      (firstMsg += `- To use the app, you need **Post** or **Everything** permissions.\n\n`)));

    /* CONFIG LINKS */
    ((firstMsg += `**Configure now:** manage templates, scheduling, notifications, and more settings here → [Relay App settings](https://developers.reddit.com/r/${subreddit.name}/apps/relay-app)\n\n\n`),
      /* COMING SOON */
      (firstMsg += `**Coming soon:** Image posting via Relay App!\n\n`));

    /* FOOTER */
    ((firstMsg += `[Terms & Conditions](https://www.reddit.com/r/RelayApp/wiki/terms-and-conditions/) | `),
      (firstMsg += `[Privacy Policy](https://www.reddit.com/r/RelayApp/wiki/privacy-policy/) | `),
      (firstMsg += `[Contact](https://reddit.com/r/RelayApp)\n\n`));

    await context.reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: "relay-app",
      subject: `Relay App: update`,
      text: firstMsg,
    });
    console.log(`Message sent to r/${event.subreddit?.name} mods.`);
    await context.reddit.setUserFlair({
      subredditName: subreddit.name,
      username: appAccount.username,
      text: "Mod Bot 🤖",
      textColor: "light",
      backgroundColor: "#FF0000",
    });
  },
});

// --- REPLY NOTIFICATIONS LISTENER ---

Devvit.addTrigger({
  event: 'CommentCreate',
  onEvent: async (event, context) => {
    if (!event.comment || !event.author?.name) return;

    // Cache comment author for 24 hours to identify replies later
    await context.redis.set(`author:${event.comment.id}`, event.author.name, { expiration: new Date(Date.now() + 86400000) });

    const settings = await context.settings.getAll();
    const appUser = await context.reddit.getAppUser();
    const extraUsers = (settings.notify_extra_users as string || "").split(',').map(u => u.trim().toLowerCase());
    
    const parentId = event.comment.parentId;
    const isReplyToPost = parentId.startsWith('t3_');
    const isReplyToComment = parentId.startsWith('t1_');

    let parentAuthor = "";
    if (isReplyToPost) {
      const post = await context.reddit.getPostById(parentId);
      parentAuthor = post.authorName ?? "[deleted]"; 
    } else if (isReplyToComment) {
      parentAuthor = (await getCommentAuthor(parentId, context)) ?? "[deleted]";
    }

    // Check if the person being replied to is Relay App or other monitored user
    const isMonitored = parentAuthor.toLowerCase() === appUser.username.toLowerCase() || extraUsers.includes(parentAuthor.toLowerCase());
    if (!isMonitored) return;

    // Check if notifications are enabled for this type of reply
    if (isReplyToPost && !settings.notify_on_posts) return;
    if (isReplyToComment && !settings.notify_on_comments) return;

    // Filter out moderators if that setting is enabled
    if (settings.notify_ignore_mods && await isModerator(event.author.name, context)) return;

   // Send Modmail notification
    await context.reddit.modMail.createModInboxConversation({
      subredditId: context.subredditId,
      subject: "Relay App: New Reply Received",
      bodyMarkdown: `u/${event.author.name} has replied to a ${isReplyToPost ? 'post' : 'comment'} by ${parentAuthor}.

**Comment Text:**
> ${event.comment.body}

[View Reply](https://www.reddit.com${event.comment.permalink})

---
*I am a bot, and this action was triggered automatically.*`,
    });
  },
});

//=========================================================
// 6. CONTEXT MENUS
// ========================================================

// --- SUBMIT POST FORM ---

const submitForm = Devvit.createForm(
  {
    title: "Submit a post",
    fields: [
      {
        name: `titleOB`,
        label: "Post title",
        type: "string",
        required: true,
      },
      {
        name: `bodyP`,
        label: "Body",
        type: "paragraph",
        required: true,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    acceptLabel: "Post",
    description:
      "This is a form for submitting a mod post through Relay App. You can edit the post later.",
    cancelLabel: "Cancel",
  },
  async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    const postTitle = _event.values.titleOB;
    var postBody = _event.values.bodyP;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock(); 
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount.username,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount.username,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- CONTEXT MENU ITEM: SUBMIT MOD POST ---

Devvit.addMenuItem({
  location: "subreddit",
  label: "[Relay App] - Submit mod post",
  description:
    "A form for submitting a post through Relay app. Post can be edited later.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();
    const botAccount = (await context.reddit.getAppUser()).username;
    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (perms?.includes("posts") || perms?.includes("all")) {
      console.log(
        `${appUser?.username} has needed permissions (${perms}), ok!`,
      );
      context.ui.showForm(submitForm);
    } else {
      console.log(
        `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
      );
      return ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- SUBMIT LINK POST FORM ---

const submitLinkForm = Devvit.createForm(
  {
    title: "Submit a link post",
    fields: [
      {
        name: `titleOB`,
        label: "Post title",
        type: "string",
        required: true,
      },
      {
        name: `linkUrl`,
        label: `Link URL`,
        type: "string",
        required: true,
        helpText: "The web address you want to share.",
      },
      {
        name: `bodyP`,
        label: "Body Text (Optional)",
        type: "paragraph",
        required: false,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    acceptLabel: "Post Link",
    description: "Submit a direct link post through Relay App.",
    cancelLabel: "Cancel",
  },
  async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    const postTitle = _event.values.titleOB;
    const linkUrl = _event.values.linkUrl;
    const postBody = _event.values.bodyP; // Capture the body text

    if (!postTitle || !linkUrl) {
      console.log(`Post missing title or link URL, returning...`);
      return ui.showToast("Title and link URL are required.");
    }

    const newPost = await context.reddit.submitPost({
      subredditName: subreddit.name,
      title: postTitle,
      url: linkUrl,
    });
    console.log(`Link Post ${newPost.id} created!`);

    if (postBody) {
        try {
          await newPost.edit({ text: postBody });
          console.log(`Ghost edit successful: Body text injected into link post.`);
        } catch (e) {
          console.error(`Ghost edit failed for link: ${e}`);
          const fallbackComment = await newPost.addComment({ text: postBody });
          await fallbackComment.distinguish();
        }
    }

    if (distinguishPost == true) {
      await newPost.distinguish();
      console.log(`Post ${newPost.id} distinguished!`);
    }
    if (stickyPost == true) {
      await newPost.sticky();
      console.log(`Post ${newPost.id} stickied!`);
    }
    if (lockPost == true) {
      await newPost.lock(); 
      console.log(`Post ${newPost.id} locked!`);
    }

    if (!setRelayAppPostFlair) {
      console.log("Auto changing the post flair is disabled, skipping...");
    } else {
      console.log("Auto changing the post flair is enabled, okay...");
      await context.reddit.setPostFlair({
        subredditName: subreddit.name,
        postId: newPost.id,
        text: relayAppFlairText,
      });
    }

    await context.reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount.username,
      label: "SOLID_CONTRIBUTOR",
      redditId: `t3_${newPost.id}`,
      note: `${currentUser?.username} created a link mod post (title: ${postTitle}).`,
    });

    const sendtoModmail = (await context?.settings.get(
      "sendModmail",
    )) as boolean;
    const sendtoDiscord = (await context?.settings.get(
      "sendDiscord",
    )) as boolean;

    var logMsg = `**Title**: ${newPost.title}\n\n`;
    logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`;
    logMsg += `**Moderator**: ${currentUser?.username}\n\n`;
    logMsg += `**Link**: ${linkUrl}\n\n`;
    if (postBody) logMsg += `**Post body**: ${postBody}\n\n`;

    ui.showToast("Link Posted!");

    if (sendtoModmail == false) {
      console.log("Not sending to Modmail, skipping...");
    } else {
      await context.reddit.sendPrivateMessageAsSubreddit({
        fromSubredditName: subreddit.name,
        to: appAccount.username,
        subject: `Mod link post submitted`,
        text: logMsg,
      });
    }

    const webhook = (await context?.settings.get("webhookEditor")) as string;
    if (!webhook) {
      console.error("No webhook URL provided");
      return;
    } else {
      try {
        let payload;
        if (sendtoDiscord == false) {
          console.log("Not sending to Discord, skipping...");
        } else {
          const discordRole = await context.settings.get("discordRole");
          let discordAlertMessage = discordRole ? `<@&${discordRole}>\n\n` : "";

          if (webhook.startsWith("https://discord.com/api/webhooks/")) {
            payload = {
              content: discordAlertMessage,
              embeds: [
                {
                  title: `${postTitle}`,
                  url: `https://reddit.com${newPost.permalink}`,
                  fields: [
                    {
                      name: "Subreddit",
                      value: `r/${subreddit.name}`,
                      inline: true,
                    },
                    {
                      name: "Moderator",
                      value: `${currentUser?.username}`,
                      inline: true,
                    },
                    {
                      name: "Link URL",
                      value: `${linkUrl}`,
                      inline: false,
                    },
                    {
                        name: "Post body",
                        value: postBody ? postBody : "*(Link Only)*",
                        inline: false,
                    },
                  ],
                },
              ],
            };
          }
        }
        
        if (payload) {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          console.log("Alert sent to Discord!");
        }
      } catch (err) {
        console.error(`Error sending alert: ${err}`);
      }
    }
  },
);

// --- CONTEXT MENU ITEM: SUBMIT MOD LINK POST ---

Devvit.addMenuItem({
  location: "subreddit",
  label: "[Relay App] - Submit mod link post",
  description:
    "A form for submitting a direct link post through Relay App.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();
    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (perms?.includes("posts") || perms?.includes("all")) {
      console.log(
        `${appUser?.username} has needed permissions (${perms}), ok!`,
      );
      context.ui.showForm(submitLinkForm); 
    } else {
      console.log(
        `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
      );
      return ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- SUBMIT MEDIA POST FORM ---

const submitMediaForm = Devvit.createForm(
  {
    title: "Submit a media post",
    fields: [
      {
        name: `titleOB`,
        label: "Post title",
        type: "string",
        required: true,
      },
      {
        name: `imageUrl`,
        label: `Direct Media URL`,
        type: "string",
        required: true,
        helpText: "Supports direct image links (.jpg, .png, etc.) or video links (YouTube, Vimeo).",
      },
      {
        name: `bodyP`,
        label: "Body Text (Optional)",
        type: "paragraph",
        required: false,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    acceptLabel: "Post Media",
    description:
      "Submit a media post through Relay App. Body text will be automatically added.",
    cancelLabel: "Cancel",
  },
  async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    const postTitle = _event.values.titleOB;
    const imageUrl = _event.values.imageUrl;
    const postBody = _event.values.bodyP;

    if (!postTitle || !imageUrl) {
      console.log(`Post missing title or media URL, returning...`);
      return ui.showToast("Title and media URL are required.");
    }

    const newPost = await context.reddit.submitPost({
      subredditName: subreddit.name,
      title: postTitle,
      url: imageUrl,
    });
    console.log(`Initial Media Post ${newPost.id} created!`);

    if (postBody) {
      try {
        await newPost.edit({ text: postBody });
        console.log(`Ghost edit successful: Body text injected.`);
      } catch (e) {
        console.error(`Ghost edit failed, falling back to comment: ${e}`);
        const fallbackComment = await newPost.addComment({ text: postBody });
        await fallbackComment.distinguish();
        try { await fallbackComment.sticky(); } catch (err) {}
      }
    }

    if (distinguishPost == true) {
      await newPost.distinguish();
      console.log(`Post ${newPost.id} distinguished!`);
    }
    if (stickyPost == true) {
      await newPost.sticky();
      console.log(`Post ${newPost.id} stickied!`);
    }
    if (lockPost == true) {
      await newPost.lock(); 
      console.log(`Post ${newPost.id} locked!`);
    }

    if (!setRelayAppPostFlair) {
      console.log("Auto changing the post flair is disabled, skipping...");
    } else {
      console.log("Auto changing the post flair is enabled, okay...");
      await context.reddit.setPostFlair({
        subredditName: subreddit.name,
        postId: newPost.id,
        text: relayAppFlairText,
      });
    }

    await context.reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount.username,
      label: "SOLID_CONTRIBUTOR",
      redditId: `t3_${newPost.id}`,
      note: `${currentUser?.username} created a media mod post (title: ${postTitle}).`,
    });
    console.log(
      `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
    );

    const sendtoModmail = (await context?.settings.get(
      "sendModmail",
    )) as boolean;
    const sendtoDiscord = (await context?.settings.get(
      "sendDiscord",
    )) as boolean;

    var logMsg = `**Title**: ${newPost.title}\n\n`;
    logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`;
    logMsg += `**Moderator**: ${currentUser?.username}\n\n`;
    logMsg += `**Media Link**: ${imageUrl}\n\n`;
    if (postBody) logMsg += `**Post body**: ${postBody}\n\n`;

    ui.showToast("Media Posted!");
    console.log(
      `${currentUser?.username} used Relay App to post media ${newPost.url}`,
    );

    if (sendtoModmail == false) {
      console.log("Not sending to Modmail, skipping...");
    } else {
      await context.reddit.sendPrivateMessageAsSubreddit({
        fromSubredditName: subreddit.name,
        to: appAccount.username,
        subject: `Mod media post submitted`,
        text: logMsg,
      });
      console.log(`Sent to Modmail!`);
    }

    const webhook = (await context?.settings.get("webhookEditor")) as string;
    if (!webhook) {
      console.error("No webhook URL provided");
      return;
    } else {
      try {
        let payload;
        if (sendtoDiscord == false) {
          console.log("Not sending to Discord, skipping...");
        } else {
          const discordRole = await context.settings.get("discordRole");
          let discordAlertMessage;
          if (discordRole) {
            discordAlertMessage = `<@&${discordRole}>\n\n`;
          } else {
            discordAlertMessage = ``;
          }

          if (webhook.startsWith("https://discord.com/api/webhooks/")) {
            console.log("Got Discord webhook, let's go!");

            payload = {
              content: discordAlertMessage,
              embeds: [
                {
                  title: `${postTitle}`,
                  url: `https://reddit.com${newPost.permalink}`,
                  image: { url: imageUrl },
                  fields: [
                    {
                      name: "Subreddit",
                      value: `r/${subreddit.name}`,
                      inline: true,
                    },
                    {
                      name: "Moderator",
                      value: `${currentUser?.username}`,
                      inline: true,
                    },
                    {
                      name: "Post body",
                      value: postBody ? postBody : "*(Media Only Post)*",
                      inline: true,
                    },
                  ],
                },
              ],
            };
          }
        }
        try {
          if (payload) {
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      } catch (err) {
        console.error(`Error sending alert: ${err}`);
      }
    }
  },
);

// --- CONTEXT MENU ITEM: SUBMIT MOD MEDIA POST ---

Devvit.addMenuItem({
  location: "subreddit",
  label: "[Relay App] - Submit mod media post",
  description:
    "A form for submitting a media post through Relay App. Body text will be injected automatically.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();
    const botAccount = (await context.reddit.getAppUser()).username;
    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (perms?.includes("posts") || perms?.includes("all")) {
      console.log(
        `${appUser?.username} has needed permissions (${perms}), ok!`,
      );
      context.ui.showForm(submitMediaForm); 
    } else {
      console.log(
        `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
      );
      return ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- EDIT MOD POST FORM ---

const editForm = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `nTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.pTitle,
        helpText: `Post title can't be edited.`,
        disabled: true,
      },
      {
        name: `nBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.pBody,
        required: true,
      },
      {
        name: `reasonRevision`,
        label: "Reason",
        type: "string",
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: data.statusDist,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
        defaultValue: data.statusSticky,
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
        defaultValue: data.statusLock,
      },
    ],
    title: "Edit post",
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (event, context) => {
    console.log(event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;
    const modEditor = (await context.reddit.getCurrentUser())?.username;
    const originalPost = context.postId!;
    const getPost = await context.reddit.getPostById(originalPost);
    const img = event.values.imgBody;
    const distinguishPost = event.values.mybDist;
    const stickyPost = event.values.iSticky;
    const lockPost = event.values.iLock;

    const sendtoModmail = (await context?.settings.get(
      "sendModmail",
    )) as boolean;
    const sendtoDiscord = (await context?.settings.get(
      "sendDiscord",
    )) as boolean;

    const oldBody = getPost.body;

    var newPostBody = event.values.nBody;

    if (distinguishPost == false) {
      console.log("Undistinguishing post...");
      getPost.undistinguish();
    } else {
      console.log("Distinguishing post...");
      getPost.distinguish();
    }

    if (stickyPost == false) {
      console.log("Unstickying post...");
      getPost.unsticky();
    } else {
      console.log("Stickying post...");
      getPost.sticky();
    }

    if (lockPost == false) {
      console.log("Unlocking post...");
      await getPost.unlock();
    } else {
      console.log("Locking post...");
      await getPost.lock();
    }

    const reasonRev = event.values.reasonRevision;
    getPost.edit({ text: newPostBody });
    context.ui.showToast("Edited!");
    console.log(`${modEditor} used Relay App to edit the post ${getPost.url}.`);

    await context.reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount,
      label: "SOLID_CONTRIBUTOR",
      note: `${modEditor} edited mod post, reason: ${reasonRev}`,
      redditId: `t3_${originalPost}`,
    });

    var logMsg = `Title: ${getPost.title}\n\n`;
    ((logMsg += `URL: https://reddit.com${getPost.permalink}\n\n`),
      (logMsg += `Moderator: ${modEditor}\n\n`));
    logMsg += `Previous post body: ${oldBody}\n\n`;
    logMsg += `New post body: ${newPostBody}\n\n`;
    logMsg += `Reason for revision: ${reasonRev}\n\n`;

    if (sendtoModmail == false) {
      console.log("Not sending to Modmail, skipping...");
    } else {
      await context.reddit.sendPrivateMessageAsSubreddit({
        fromSubredditName: subreddit.name,
        to: appAccount,
        subject: `Edited mod post`,
        text: logMsg,
      });
    }

    const webhook = (await context?.settings.get("webhookEditor")) as string;

    console.log(`Received ModEdit trigger event:\n${JSON.stringify(event)}`);

    if (!webhook) {
      console.error("No webhook URL provided");
      return;
    } else {
      try {
        let payload;

        if (sendtoDiscord == false) {
          console.log("Not sending to Discord, skipping...");
        } else {
          const discordRole = await context.settings.get("discordRole");

          let discordAlertMessage;
          if (discordRole) {
            discordAlertMessage = `<@&${discordRole}>\n\n`;
          } else {
            discordAlertMessage = ``;
          }

          if (webhook.startsWith("https://discord.com/api/webhooks/")) {
            console.log("Got Discord webhook, let's go!");

            // Check if the webhook is a Discord webhook
            payload = {
              content: discordAlertMessage,
              embeds: [
                {
                  title: `${getPost.title}`,
                  url: `https://reddit.com${getPost.permalink}`,
                  fields: [
                    {
                      name: "Subreddit",
                      value: `r/${subreddit.name}`,
                      inline: true,
                    },
                    {
                      name: "Moderator",
                      value: `${modEditor}`,
                      inline: true,
                    },
                    {
                      name: "Previous post body",
                      value: `${oldBody}`,
                      inline: true,
                    },
                    {
                      name: "New post body",
                      value: `${newPostBody}`,
                      inline: true,
                    },
                    {
                      name: "Reason",
                      value: `${reasonRev}`,
                      inline: true,
                    },
                    {
                      name: "Score",
                      value: `${getPost.score}`,
                      inline: true,
                    },
                  ],
                },
              ],
            };
          }
        }

        try {
          // Send alert to Discord
          await fetch(webhook, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          console.log("Alert sent to Discord!");
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      } catch (err) {
        console.error(`Error sending alert: ${err}`);
      }
    }
  },
);

// --- CONTEXT MENU ITEM: EDIT MOD POST ---

Devvit.addMenuItem({
  location: "post",
  label: "[Relay App] - Edit post",
  description: "A form for editing a post through Relay App.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const originalPost = context.postId!;
    const getPost = await context.reddit.getPostById(originalPost);
    const postOP = getPost.authorName;
    const appUser = await context.reddit.getCurrentUser();

    const checkDist = getPost.isDistinguishedBy();
    const checkSt = getPost.isStickied();

    const postTitle = getPost.title;

    const botAccount = (await context.reddit.getAppUser()).username;

    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (postOP == botAccount) {
      console.log(`${postOP} = ${botAccount}, ok!`);
      if (perms?.includes("posts") || perms?.includes("all")) {
        console.log(
          `${appUser?.username} has needed permissions (${perms}), ok!`,
        );
        context.ui.showForm(editForm, {
          pTitle: getPost.title,
          pBody: getPost.body ?? "",
          statusDist: checkDist ?? false,
          statusSticky: checkSt ?? false,
        });
      } else {
        console.log(
          `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
        );
        return ui.showToast(`You don't have the necessary permissions.`);
      }
    } else {
      console.log(`${postOP} != ${botAccount}, not ok!`);
      return ui.showToast(`Sorry, this is not submission from ${botAccount}!`);
    }
  },
});

// --- SUBMIT COMMENT REPLY FORM ---

const submitCommentReply = Devvit.createForm(
  {
    title: "Submit a comment",
    fields: [
      {
        name: `bodyC`,
        label: "Text",
        type: "paragraph",
        required: true,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    acceptLabel: "Publish",
    description:
      "This is a form for submitting a mod comment through Relay App. You can edit the comment later.",
    cancelLabel: "Cancel",
  },
  async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();
    const currentUser = await reddit.getCurrentUser();

    var commentBody = _event.values.bodyC;

    const originalPost = context.postId!;
    const previousComment = context.commentId!;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterCommenting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppCommentPostFlairText",
    )) as string;

    const newComment = await context.reddit.submitComment({
      id: originalPost,
      text: `${commentBody}`,
    });

    const distinguishComment = _event.values.mybDist;
    const stickyComment = _event.values.iSticky;
    const lockComment = _event.values.iLock;
    if (distinguishComment == true) {
      newComment.distinguish();
      console.log(`Comment ${newComment.id} distinguished!`);
    }
    if (stickyComment == true) {
      newComment.distinguish(true);
      console.log(`Comment ${newComment.id} stickied!`);
    }
    if (lockComment == true) {
      newComment.lock(); 
      console.log(`Comment ${newComment.id} locked!`);
    }
    await context.reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount.username,
      label: "SOLID_CONTRIBUTOR",
      redditId: newComment.id,
      note: `${currentUser?.username} created a mod comment.`,
    });
    console.log(
      `Added mod note for comment ${newComment.id} by ${currentUser?.username}.`,
    );

    if (!setRelayAppPostFlair) {
      console.log("Auto changing the post flair is disabled, skipping...");
    } else {
      console.log("Auto changing the post flair is enabled, okay...");
      await context.reddit.setPostFlair({
        subredditName: subreddit.name,
        postId: newComment.postId,
        text: relayAppFlairText,
      });
    }
    ui.showToast("Posted!");
    console.log(
      `${currentUser?.username} used Relay App to post a comment ${newComment.url}`,
    );
  },
);

// --- CONTEXT MENU ITEM: SUBMIT MOD COMMENT REPLY ---

Devvit.addMenuItem({
  location: ["post", "comment"],
  label: "[Relay App] - Comment",
  description:
    "A form for submitting a comment through Relay App. Comments can be edited later.",
  forUserType: "moderator",
  onPress: async (event, context) => {
    const { ui } = context;
    const { location } = event;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();
    const botAccount = (await context.reddit.getAppUser()).username;
    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (location === "post") {
      if (perms?.includes("posts") || perms?.includes("all")) {
        console.log(
          `${appUser?.username} has needed permissions (${perms}), ok!`,
        );
        context.ui.showForm(submitCommentReply);
      } else {
        console.log(
          `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
        );
        return ui.showToast(`You don't have the necessary permissions.`);
      }
    }

    if (location === "comment") {
      if (perms?.includes("posts") || perms?.includes("all")) {
        console.log(
          `${appUser?.username} has needed permissions (${perms}), ok!`,
        );
        context.ui.showForm(submitCommentReply);
      } else {
        console.log(
          `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
        );
        return ui.showToast(`You don't have the necessary permissions.`);
      }
    }
  },
});

// --- CONTEXT MENU ITEM: EDIT MOD COMMENT ---

Devvit.addMenuItem({
  location: "comment",
  label: "[Relay App] - Edit comment",
  description: "A form for editing a comment through Relay App.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const originalComment = context.commentId!;
    const getComment = await context.reddit.getCommentById(originalComment);
    const commentAuthor = getComment.authorName;
    const appUser = await context.reddit.getCurrentUser();

    const checkDist = getComment.isDistinguished();
    const checkSt = getComment.isStickied();

    const botAccount = (await context.reddit.getAppUser()).username;

    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (commentAuthor == botAccount) {
      console.log(`${commentAuthor} = ${botAccount}, ok!`);
      if (perms?.includes("posts") || perms?.includes("all")) {
        console.log(
          `${appUser?.username} has needed permissions (${perms}), ok!`,
        );
        context.ui.showForm(editComment, {
          cBody: getComment.body,
          statusDist: checkDist,
          statusSticky: checkSt,
        });
      } else {
        console.log(
          `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
        );
        return ui.showToast(`You don't have the necessary permissions.`);
      }
    } else {
      console.log(`${commentAuthor} != ${botAccount}, not ok!`);
      return ui.showToast(`Sorry, this is not submission from ${botAccount}!`);
    }
  },
});

// --- EDIT MOD COMMENT FORM ---

const editComment = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `nBody`,
        label: "Comment",
        type: "paragraph",
        defaultValue: data.cBody,
        required: true,
      },
      {
        name: `reasonRevision`,
        label: "Reason",
        type: "string",
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: data.statusDist,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
        defaultValue: data.statusSticky,
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
        defaultValue: data.statusLock,
      },
    ],
    title: "Edit comment",
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (event, context) => {
    console.log(event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;
    const modEditor = (await context.reddit.getCurrentUser())?.username;
    const originalComment = context.commentId!;
    const getComment = await context.reddit.getCommentById(originalComment);
    const img = event.values.imgBody;
    const distinguishComment = event.values.mybDist;
    const stickyComment = event.values.iSticky;
    const lockComment = event.values.iLock;

    const sendtoModmail = (await context?.settings.get(
      "sendModmail",
    )) as boolean;

    const oldBody = getComment.body;

    var newCommentText = event.values.nBody;

    if (distinguishComment == false) {
      console.log("Undistinguishing comment...");
      getComment.undistinguish();
    } else {
      console.log("Distinguishing comment...");
      getComment.distinguish();
    }

    if (stickyComment == false) {
      console.log("Unstickying comment...");
      getComment.distinguish(false);
    } else {
      console.log("Stickying comment...");
      getComment.distinguish(true);
    }

    if (lockComment == false) {
      console.log("Unlocking comment...");
      await getComment.unlock();
    } else {
      console.log("Locking comment...");
      await getComment.lock();
    }

    const reasonRev = event.values.reasonRevision;
    getComment.edit({ text: newCommentText });
    context.ui.showToast("Edited!");
    console.log(`${modEditor} used Relay App to post ${getComment.url}`);

    await context.reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount,
      label: "SOLID_CONTRIBUTOR",
      note: `${modEditor} edited mod comment, reason: ${reasonRev}`,
      redditId: `t1_${originalComment}`,
    });

    var logMsg = `Comment URL: https://reddit.com${getComment.permalink}\n\n`;
    logMsg += `Moderator: ${modEditor}\n\n`;
    logMsg += `Previous version: ${oldBody}\n\n`;
    logMsg += `New version: ${newCommentText}\n\n`;
    logMsg += `Reason for revision: ${reasonRev}\n\n`;

    if (sendtoModmail == false) {
      console.log("Not sending to Modmail, skipping...");
    } else {
      await context.reddit.sendPrivateMessageAsSubreddit({
        fromSubredditName: subreddit.name,
        to: appAccount,
        subject: `Edited mod comment`,
        text: logMsg,
      });
    }
  },
);

// --- CONTEXT MENU ITEM: DELETE MOD POST ---

Devvit.addMenuItem({
  location: ["post"],
  forUserType: "moderator",
  label: "[Relay App] - Delete content",
  description: "Option to delete post by Relay App",
  onPress: async (event, context) => {
    const { reddit, ui } = context;
    const { location } = event;
    const subreddit = await context.reddit.getCurrentSubreddit();
    const postId = context.postId!;
    const appUser = context.reddit.getAppUser();
    const currentUser = await context.reddit.getCurrentUser();
    const perms = await currentUser?.getModPermissionsForSubreddit(
      subreddit.name,
    );
    const appPost = await context.reddit.getPostById(postId);

    if (
      (location === "post" && perms?.includes("posts")) ||
      perms?.includes("all")
    ) {
      if (
        (await context.reddit.getPostById(context.postId!)).authorName ==
        (await appUser).username
      ) {
        appPost.delete();
        console.log(`Relay App content deleted by ${currentUser?.username}.`);
        return ui.showToast("Deleted!");
      } else {
        ui.showToast(
          `This is only for content removal by ${(await appUser).username}!`,
        );
      }
    } else {
      ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- CONTEXT MENU ITEM: DELETE MOD COMMENT ---

Devvit.addMenuItem({
  location: ["comment"],
  forUserType: "moderator",
  label: "[Relay App] - Delete content",
  description: "Option to delete comment by Relay App",
  onPress: async (event, context) => {
    const { reddit, ui } = context;
    const { location } = event;
    const subreddit = await context.reddit.getCurrentSubreddit();
    const commentId = context.commentId!;
    const appUser = context.reddit.getAppUser();
    const currentUser = await context.reddit.getCurrentUser();
    const perms = await currentUser?.getModPermissionsForSubreddit(
      subreddit.name,
    );
    const appComment = await context.reddit.getCommentById(commentId);

    if (
      (location === "comment" && perms?.includes("posts")) ||
      perms?.includes("all")
    ) {
      if (
        (await context.reddit.getCommentById(context.commentId!)).authorName ==
        (await appUser).username
      ) {
        appComment.delete();
        console.log(`Relay App comment deleted by ${currentUser?.username}.`);
        return ui.showToast("Deleted!");
      } else {
        ui.showToast(
          `This is only for content removal by ${(await appUser).username}!`,
        );
      }
    } else {
      ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- CONTEXT MENU ITEM: SUBMIT MOD POST USING TEMPLATE ---

Devvit.addMenuItem({
  location: "subreddit",
  label: "[Relay App] - Use template",
  description: "Submit a mod post using templates.",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();

    const template1name = (await context?.settings.get(
      "postTemplate1name",
    )) as string;
    const template1title = (await context?.settings.get(
      "postTemplate1title",
    )) as string;
    const template1body = (await context?.settings.get(
      "postTemplate1body",
    )) as Paragraph;

    const template2name = (await context?.settings.get(
      "postTemplate2name",
    )) as string;
    const template2title = (await context?.settings.get(
      "postTemplate2title",
    )) as string;
    const template2body = (await context?.settings.get(
      "postTemplate2body",
    )) as Paragraph;

    const template3name = (await context?.settings.get(
      "postTemplate3name",
    )) as string;
    const template3title = (await context?.settings.get(
      "postTemplate3title",
    )) as string;
    const template3body = (await context?.settings.get(
      "postTemplate3body",
    )) as Paragraph;

    const template4name = (await context?.settings.get(
      "postTemplate4name",
    )) as string;
    const template4title = (await context?.settings.get(
      "postTemplate4title",
    )) as string;
    const template4body = (await context?.settings.get(
      "postTemplate4body",
    )) as Paragraph;

    const template5name = (await context?.settings.get(
      "postTemplate5name",
    )) as string;
    const template5title = (await context?.settings.get(
      "postTemplate5title",
    )) as string;
    const template5body = (await context?.settings.get(
      "postTemplate5body",
    )) as Paragraph;

    const botAccount = (await context.reddit.getAppUser()).username;

    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (perms?.includes("posts") || perms?.includes("all")) {
      console.log(
        `${appUser?.username} has needed permissions (${perms}), ok!`,
      );
      context.ui.showForm(useTemplate, {
        tempName1: template1name,
        tempTitle1: template1title,
        tempBody1: template1body,
        tempName2: template2name,
        tempTitle2: template2title,
        tempBody2: template2body,
        tempName3: template3name,
        tempTitle3: template3title,
        tempBody3: template3body,
        tempName4: template4name,
        tempTitle4: template4title,
        tempBody4: template4body,
        tempName5: template5name,
        tempTitle5: template5title,
        tempBody5: template5body,
      });
    } else {
      console.log(
        `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
      );
      return ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// --- USE TEMPLATE FORM ---

const useTemplate = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumber`,
        label: "Select template",
        type: "select",
        options: [
          { label: data.tempName1, value: "template1" },
          { label: data.tempName2, value: "template2" },
          { label: data.tempName3, value: "template3" },
          { label: data.tempName4, value: "template4" },
          { label: data.tempName5, value: "template5" },
        ],
      },
    ],
    title: "Use template",
    acceptLabel: "Select",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const template1name = (await context?.settings.get(
      "postTemplate1name",
    )) as string;
    const template1title = (await context?.settings.get(
      "postTemplate1title",
    )) as string;
    const template1body = (await context?.settings.get(
      "postTemplate1body",
    )) as Paragraph;

    const template2name = (await context?.settings.get(
      "postTemplate2name",
    )) as string;
    const template2title = (await context?.settings.get(
      "postTemplate2title",
    )) as string;
    const template2body = (await context?.settings.get(
      "postTemplate2body",
    )) as Paragraph;

    const template3name = (await context?.settings.get(
      "postTemplate3name",
    )) as string;
    const template3title = (await context?.settings.get(
      "postTemplate3title",
    )) as string;
    const template3body = (await context?.settings.get(
      "postTemplate3body",
    )) as Paragraph;

    const template4name = (await context?.settings.get(
      "postTemplate4name",
    )) as string;
    const template4title = (await context?.settings.get(
      "postTemplate4title",
    )) as string;
    const template4body = (await context?.settings.get(
      "postTemplate4body",
    )) as Paragraph;

    const template5name = (await context?.settings.get(
      "postTemplate5name",
    )) as string;
    const template5title = (await context?.settings.get(
      "postTemplate5title",
    )) as string;
    const template5body = (await context?.settings.get(
      "postTemplate5body",
    )) as Paragraph;

    if (_event.values.templateNumber == "template1") {
      context.ui.showForm(useTemplateOne, {
        tempName1: template1name,
        tempTitle1: template1title,
        tempBody1: template1body,
      });
    } else if (_event.values.templateNumber == "template2") {
      context.ui.showForm(useTemplateTwo, {
        tempName2: template2name,
        tempTitle2: template2title,
        tempBody2: template2body,
      });
    } else if (_event.values.templateNumber == "template3") {
      context.ui.showForm(useTemplateThree, {
        tempName3: template3name,
        tempTitle3: template3title,
        tempBody3: template3body,
      });
      } else if (_event.values.templateNumber == "template4") {
      context.ui.showForm(useTemplateFour, {
        tempName4: template4name,
        tempTitle4: template4title,
        tempBody4: template4body,
      });
      } else if (_event.values.templateNumber == "template5") {
      context.ui.showForm(useTemplateFive, {
        tempName5: template5name,
        tempTitle5: template5title,
        tempBody5: template5body,
      });
    } else {
      context.ui.showToast("You must select a template.");
    }
  },
);

// --- USE TEMPLATE ONE FORM ---

const useTemplateOne = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumberOneTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.tempTitle1,
      },
      {
        name: `templateNumberOneBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.tempBody1,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    title: data.tempName1,
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    const { reddit, ui } = context;
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const postTitle = _event.values.templateNumberOneTitle;
    var postBody = _event.values.templateNumberOneBody;
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock();
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- USE TEMPLATE TWO FORM ---

const useTemplateTwo = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumberTwoTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.tempTitle2,
      },
      {
        name: `templateNumberTwoBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.tempBody2,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    title: data.tempName2,
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    const { reddit, ui } = context;
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const postTitle = _event.values.templateNumberTwoTitle;
    var postBody = _event.values.templateNumberTwoBody;
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock();
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- USE TEMPLATE THREE FORM ---

const useTemplateThree = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumberThreeTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.tempTitle3,
      },
      {
        name: `templateNumberThreeBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.tempBody3,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        defaultValue: true,
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    title: data.tempName3,
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    const { reddit, ui } = context;
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const postTitle = _event.values.templateNumberThreeTitle;
    var postBody = _event.values.templateNumberThreeBody;
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock();
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- USE TEMPLATE FOUR FORM ---

const useTemplateFour = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumberFourTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.tempTitle4,
      },
      {
        name: `templateNumberFourBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.tempBody4,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    title: data.tempName4,
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    const { reddit, ui } = context;
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const postTitle = _event.values.templateNumberFourTitle;
    var postBody = _event.values.templateNumberFourBody;
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock();
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- USE TEMPLATE FIVE FORM ---

const useTemplateFive = Devvit.createForm(
  (data) => ({
    fields: [
      {
        name: `templateNumberFiveTitle`,
        label: "Post title",
        type: "string",
        defaultValue: data.tempTitle5,
      },
      {
        name: `templateNumberFiveBody`,
        label: "Post body",
        type: "paragraph",
        defaultValue: data.tempBody5,
      },
      {
        name: `mybDist`,
        label: `Distinguish?`,
        type: "boolean",
        defaultValue: true,
        helpText:
          "All content created by the app is distinguished, so users clearly see they come from the mod team.",
        disabled: true,
      },
      {
        name: `iSticky`,
        label: `Sticky?`,
        type: "boolean",
      },
      {
        name: `iLock`,
        label: `Lock?`,
        type: "boolean",
      },
    ],
    title: data.tempName5,
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  }),
  async (_event, context) => {
    const { reddit, ui } = context;
    console.log(_event.values);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const appAccount = (await context.reddit.getAppUser()).username;

    const postTitle = _event.values.templateNumberFiveTitle;
    var postBody = _event.values.templateNumberFiveBody;
    const currentUser = await reddit.getCurrentUser();

    const distinguishPost = _event.values.mybDist;
    const stickyPost = _event.values.iSticky;
    const lockPost = _event.values.iLock;

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    if (!postTitle) {
      console.log(`Post doesn't have title, returning...`);
      return ui.showToast("Sorry, no title.");
    } else {
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: postTitle,
        text: postBody,
      });

      if (distinguishPost == true) {
        newPost.distinguish();
        console.log(`Post ${newPost.id} distinguished!`);
      }
      if (stickyPost == true) {
        newPost.sticky();
        console.log(`Post ${newPost.id} stickied!`);
      }
      if (lockPost == true) {
        newPost.lock();
        console.log(`Post ${newPost.id} locked!`);
      }

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${postTitle}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url}`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    }
  },
);

// --- CONTEXT MENU ITEM: APPLY SCHEDULED POSTS ---

Devvit.addMenuItem({
  location: "subreddit",
  label: "[Relay App] - Apply Scheduled Posts",
  description: "Apply scheduled posts based on saved templates.",
  forUserType: "moderator",
  onPress: async (event, context) => {
    await applySchedules(context);
    context.ui.showToast('Scheduled posts updated successfully!');
  },
});

// --- CONTEXT MENU ITEM: CLONE POST ---

Devvit.addMenuItem({
  location: "post",
  label: "[Relay App] - Clone post",
  description:
    "Option to quickly clone this post. You can edit the post later.",
  forUserType: "moderator",
  onPress: async (event, context) => {
    const { ui } = context;

    const subreddit = await context.reddit.getCurrentSubreddit();
    const appUser = await context.reddit.getCurrentUser();
    const oldPostId = context.postId!;
    const oldPost = await context.reddit.getPostById(oldPostId);

    const oldPostTitle = oldPost.title;
    const oldPostBody = oldPost.body;

    const appAccount = await context.reddit.getAppUser();
    const currentUser = await context.reddit.getCurrentUser();

    const setRelayAppPostFlair = (await context?.settings.get(
      "setFlairAfterPosting",
    )) as boolean;
    const relayAppFlairText = (await context?.settings.get(
      "relayAppPostFlairText",
    )) as string;

    const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

    if (!oldPostTitle) {
      console.log(`Post doesn't have title, returning...`);
    }

    if (!oldPostBody) {
      console.log(`Post doesn't have title, returning...`);
    }

    if (perms?.includes("posts") || perms?.includes("all")) {
      console.log(
        `${appUser?.username} has needed permissions (${perms}), ok!`,
      );
      const newPost = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: oldPostTitle,
        text: oldPostBody!,
      });
      newPost.distinguish();

      if (!setRelayAppPostFlair) {
        console.log("Auto changing the post flair is disabled, skipping...");
      } else {
        console.log("Auto changing the post flair is enabled, okay...");
        await context.reddit.setPostFlair({
          subredditName: subreddit.name,
          postId: newPost.id,
          text: relayAppFlairText,
        });
      }
      await context.reddit.addModNote({
        subreddit: subreddit.name,
        user: appAccount.username,
        label: "SOLID_CONTRIBUTOR",
        redditId: newPost.id,
        note: `${currentUser?.username} created a mod post (title: ${newPost.title}).`,
      });
      console.log(
        `Added mod note for post ${newPost.id} by ${currentUser?.username}.`,
      );
      const sendtoModmail = (await context?.settings.get(
        "sendModmail",
      )) as boolean;
      const sendtoDiscord = (await context?.settings.get(
        "sendDiscord",
      )) as boolean;
      var logMsg = `**Title**: ${newPost.title}\n\n`;
      ((logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`),
        (logMsg += `**Moderator**: ${currentUser?.username}\n\n`));
      logMsg += `**Post body**: ${newPost.body}\n\n`;

      ui.showToast("Posted!");
      console.log(
        `${currentUser?.username} used Relay App to post ${newPost.url} (Clone option).`,
      );
      if (sendtoModmail == false) {
        console.log("Not sending to Modmail, skipping...");
      } else {
        await context.reddit.sendPrivateMessageAsSubreddit({
          fromSubredditName: subreddit.name,
          to: appAccount.username,
          subject: `Mod post submitted`,
          text: logMsg,
        });
        console.log(`Sent to Modmail!`);
      }
      const webhook = (await context?.settings.get("webhookEditor")) as string;
      if (!webhook) {
        console.error("No webhook URL provided");
        return;
      } else {
        try {
          let payload;
          if (sendtoDiscord == false) {
            console.log("Not sending to Discord, skipping...");
          } else {
            const discordRole = await context.settings.get("discordRole");
            let discordAlertMessage;
            if (discordRole) {
              discordAlertMessage = `<@&${discordRole}>\n\n`;
            } else {
              discordAlertMessage = ``;
            }

            if (webhook.startsWith("https://discord.com/api/webhooks/")) {
              console.log("Got Discord webhook, let's go!");

              // Check if the webhook is a Discord webhook
              payload = {
                content: discordAlertMessage,
                embeds: [
                  {
                    title: `${newPost.title}`,
                    url: `https://reddit.com${newPost.permalink}`,
                    fields: [
                      {
                        name: "Subreddit",
                        value: `r/${subreddit.name}`,
                        inline: true,
                      },
                      {
                        name: "Moderator",
                        value: `${currentUser?.username}`,
                        inline: true,
                      },
                      {
                        name: "Post body",
                        value: `${newPost.body}`,
                        inline: true,
                      },
                    ],
                  },
                ],
              };
            }
          }
          try {
            // Send alert to Discord
            await fetch(webhook, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            console.log("Alert sent to Discord!");
          } catch (err) {
            console.error(`Error sending alert: ${err}`);
          }
        } catch (err) {
          console.error(`Error sending alert: ${err}`);
        }
      }
    } else {
      console.log(
        `${appUser?.username} doesn't have Posts permission (${perms}), not ok!`,
      );
      return ui.showToast(`You don't have the necessary permissions.`);
    }
  },
});

// ==========================================
// SCHEDULER SETUP
// ==========================================

// --- HELPER TO GENERATE CRON EXPRESSION FOR MONTHLY SCHEDULING ---

function getMonthlyCron(monthDay: number, hour: number, minute: number, targetDate: Date = new Date()): string {
  if (monthDay < 1) monthDay = 1;
  if (monthDay > 31) monthDay = 31;

  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(monthDay, daysInMonth);

  return `${minute} ${hour} ${day} * *`;
}

// --- APPLY SCHEDULED POSTS BASED ON SAVED SETTINGS ---

async function applySchedules(context: Devvit.Context) {
  const scheduler = context.scheduler;

// --- CLEAR EXISTING SCHEDULED JOBS ---

  const currentJobs = await scheduler.listJobs();
  await Promise.all(
    currentJobs
      .filter((job) => job.name === 'scheduled_post_job')
      .map((job) => scheduler.cancelJob(job.id))
  );

// --- SET UP NEW SCHEDULED JOBS BASED ON SETTINGS ---

  for (const i of [1, 2, 3, 4, 5]) {
    const enabled = await context.settings.get(`postTemplate${i}Enabled`) as boolean;
    if (!enabled) continue;

    const weekly = await context.settings.get(`postTemplate${i}Repeat`) as boolean;
    const weeklyDay = await context.settings.get(`postTemplate${i}Day`) as string;
    const monthly = await context.settings.get(`postTemplate${i}Monthly`) as boolean;
    const monthDay = await context.settings.get(`postTemplate${i}MonthDay`) as number;
    const hour = await context.settings.get(`postTemplate${i}Hour`) as number;
    const minute = await context.settings.get(`postTemplate${i}Minute`) as number;

// --- DETERMINE CRON EXPRESSION BASED ON SCHEDULE TYPE ---

    const cron = weekly
      ? `${minute} ${hour} * * ${weeklyDay}`   // Weekly
      : monthly
        ? getMonthlyCron(monthDay, hour, minute)   // Monthly
        : `${minute} ${hour} * * ${weeklyDay}`;      // One-time on selected day

// --- SCHEDULE THE JOB ---

    await scheduler.runJob({
      name: 'scheduled_post_job',
      cron,
      data: { templateNumber: i },
    });
  }
}

// ==========================================
// HELPERS FOR NOTIFICATIONS
// ==========================================

// --- CACHES COMMENT AUTHOR NAMES TO REDUCE API CALLS ---
async function getCommentAuthor(commentId: string, context: any): Promise<string> {
  const cachedAuthor = await context.redis.get(`author:${commentId}`);
  if (cachedAuthor) return cachedAuthor;
  try {
    const comment = await context.reddit.getCommentById(commentId);
    return comment.authorName ?? "[deleted]"; // Return "[deleted]" if author is null
  } catch {
    return "[deleted]"; // Return "[deleted]" if comment retrieval fails
  }
}

// --- CHECKS IF A USER IS A MODERATOR OF THE SUBREDDIT ---
async function isModerator(username: string, context: any): Promise<boolean> {
  const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubredditName());
  if (username === `${subredditName}-ModTeam` || username === "AutoModerator") return true;
  try {
    const moderators = await context.reddit.getModerators({ subredditName, username }).all();
    return moderators.length > 0;
  } catch {
    return false;
  }
}

export default Devvit;
