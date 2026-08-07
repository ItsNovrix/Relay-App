import type { Context } from 'hono';
import { reddit, redis, settings, scheduler } from "@devvit/web/server";
import { getMonthlyCron } from "../utils/helpers.js";

export const handleScheduledPostJob = async (c: Context) => {
  const event = await c.req.json();
  const { templateNumber } = event.data || {};
  
  if (!templateNumber) return c.json({ success: true });

  const subreddit = await reddit.getCurrentSubreddit();
    
  // --- FETCH TEMPLATE SETTINGS ---
  const title = await settings.get(`postTemplate${templateNumber}title`) as string;
  const body = await settings.get(`postTemplate${templateNumber}body`) as string;
  const sticky = await settings.get(`postTemplate${templateNumber}Sticky`) as boolean;
  const lock = await settings.get(`postTemplate${templateNumber}Lock`) as boolean;

  // --- TOGGLES FOR POST CLEANUP (UNSTICKY/LOCK PREVIOUS POST) ---
  const autoUnsticky = await settings.get(`postTemplate${templateNumber}AutoUnsticky`) as boolean;
  const autoLock = await settings.get(`postTemplate${templateNumber}AutoLock`) as boolean;

  if (!title) return c.json({ success: true });

  // --- CLEANUP PREVIOUS POST ---
  const redisKey = `last_post_id_template_${templateNumber}`;
  const lastPostId = await redis.get(redisKey);

  if (lastPostId && (autoUnsticky || autoLock)) {
    try {
      const oldPost = await reddit.getPostById(`t3_${lastPostId.replace(/^t3_/, '')}` as `t3_${string}`);
      if (autoUnsticky) await oldPost.unsticky();
      if (autoLock) await oldPost.lock();
      console.log(`Cleaned up previous post ${lastPostId} for Template ${templateNumber}`);
    } catch (e) {
      console.log(`Cleanup skipped: Previous post ${lastPostId} not found or already handled.`);
    }
  }

  const post = await reddit.submitPost({
    subredditName: subreddit.name,
    title: title,
    text: body,
  });

  // --- SAVE NEW POST ID FOR NEXT RUN'S CLEANUP ---
  await redis.set(redisKey, post.id);

  await post.distinguish();
  if (sticky) await post.sticky();
  if (lock) await post.lock();

  console.log(`Scheduled Template ${templateNumber} posted successfully!`);

  // --- RESCHEDULE OR CANCEL JOB ---
  const repeatWeekly = await settings.get(`postTemplate${templateNumber}Repeat`) as boolean;
  const monthly = await settings.get(`postTemplate${templateNumber}Monthly`) as boolean;
  const monthDay = await settings.get(`postTemplate${templateNumber}MonthDay`) as number;
  const hour = await settings.get(`postTemplate${templateNumber}Hour`) as number;
  const minute = await settings.get(`postTemplate${templateNumber}Minute`) as number;

  // --- HELPER FUNCTION TO GET MONTHLY CRON EXPRESSION ---
  if (monthly) {
    const nextMonthDate = new Date();
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);

    const nextCron = getMonthlyCron(monthDay, hour, minute, nextMonthDate);

    await scheduler.runJob({
      name: 'scheduled_post_job',
      cron: nextCron,
      data: { templateNumber },
    });

    console.log(`Monthly Template ${templateNumber} rescheduled for next month.`);
  }

  if (!repeatWeekly && !monthly && event.job?.id) {
    await scheduler.cancelJob(event.job.id);
  }

  return c.json({ success: true });
};