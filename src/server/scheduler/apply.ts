import type { Context } from 'hono';
import { settings, scheduler } from "@devvit/web/server";
import { getMonthlyCron } from "../utils/helpers.js";

export const handleApplySchedules = async (c: Context) => {
  // --- CLEAR EXISTING SCHEDULED JOBS ---
  const currentJobs = await scheduler.listJobs();
  await Promise.all(
    currentJobs
      .filter((job) => job.name === 'scheduled_post_job')
      .map((job) => scheduler.cancelJob(job.id))
  );

  // --- SET UP NEW SCHEDULED JOBS BASED ON SETTINGS ---
  for (const i of [1, 2, 3, 4, 5]) {
    const enabled = await settings.get(`postTemplate${i}Enabled`) as boolean;
    if (!enabled) continue;

    const weekly = await settings.get(`postTemplate${i}Repeat`) as boolean;
    const weeklyDay = await settings.get(`postTemplate${i}Day`) as string;
    const monthly = await settings.get(`postTemplate${i}Monthly`) as boolean;
    const monthDay = await settings.get(`postTemplate${i}MonthDay`) as number;
    const hour = await settings.get(`postTemplate${i}Hour`) as number;
    const minute = await settings.get(`postTemplate${i}Minute`) as number;

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

  // --- RESPOND TO MENU CLICK ---
  return c.json({
    showToast: { text: "Scheduled posts updated successfully!", appearance: "success" }
  });
};