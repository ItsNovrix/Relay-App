import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort, reddit, redis, settings } from '@devvit/web/server';
import type { OnPostCreateRequest, OnAppInstallRequest, OnAppUpgradeRequest } from '@devvit/web/shared';

// --- IMPORT TRIGGERS ---
import { handleAppInstall } from './triggers/install.js';
import { handleAppUpgrade } from './triggers/upgrade.js';
import { handleCommentCreate } from './triggers/comment.js';

// --- IMPORT SCHEDULER ---
import { handleUpgradeCheckJob } from './scheduler/upgradeJob.js';
import { handleScheduledPostJob } from './scheduler/postJob.js';
import { handleApplySchedules } from './scheduler/apply.js';

// --- IMPORT MENUS ---
import { handleSubmitPostMenu } from './menus/submitPostMenu.js';
import { handleSubmitLinkMenu } from './menus/submitLinkMenu.js';
import { handleSubmitMediaMenu } from './menus/submitMediaMenu.js';
import { handleSubmitCommentMenu } from './menus/submitCommentMenu.js';
import { handleEditPostMenu } from './menus/editPostMenu.js';
import { handleUseTemplateMenu } from './menus/useTemplateMenu.js';
import { handleClonePostMenu } from './menus/clonePostMenu.js';
import { handleDeleteContentMenu } from './menus/deleteContentMenu.js';
import { handleEditCommentMenu } from './menus/editCommentMenu.js'; 

// --- IMPORT FORMS ---
import { handleSubmitPostForm } from './forms/submitPostForm.js';
import { handleSubmitLinkForm } from './forms/submitLinkForm.js';
import { handleSubmitMediaForm } from './forms/submitMediaForm.js';
import { handleSubmitCommentForm } from './forms/submitCommentForm.js';
import { handleEditPostForm } from './forms/editPostForm.js';
import { handleSelectTemplateForm } from './forms/selectTemplateForm.js';
import { handleSubmitTemplateForm } from './forms/submitTemplateForm.js';
import { handleEditCommentForm } from './forms/editCommentForm.js';

const app = new Hono();

// ==========================================
// ROUTES
// ==========================================

// Triggers
app.post('/internal/triggers/on-app-install', handleAppInstall);
app.post('/internal/triggers/on-app-upgrade', handleAppUpgrade);
app.post('/internal/triggers/on-comment-create', handleCommentCreate);

// Scheduler
app.post('/internal/scheduler/upgrade-notifier-job', handleUpgradeCheckJob);
app.post('/internal/scheduler/scheduled-post-job', handleScheduledPostJob);
app.post('/internal/scheduler/apply', handleApplySchedules);

// Menus
app.post('/internal/menu/submit-mod-post', handleSubmitPostMenu);
app.post('/internal/menu/submit-link-post', handleSubmitLinkMenu);
app.post('/internal/menu/submit-media-post', handleSubmitMediaMenu);
app.post('/internal/menu/submit-comment', handleSubmitCommentMenu);
app.post('/internal/menu/edit-post', handleEditPostMenu);
app.post('/internal/menu/use-template', handleUseTemplateMenu);
app.post('/internal/menu/clone-post', handleClonePostMenu);
app.post('/internal/menu/delete-content', handleDeleteContentMenu);
app.post('/internal/menu/edit-comment', handleEditCommentMenu);

// Forms
app.post('/internal/form/submit-mod-post', handleSubmitPostForm);
app.post('/internal/form/submit-link-post', handleSubmitLinkForm);
app.post('/internal/form/submit-media-post', handleSubmitMediaForm);
app.post('/internal/form/submit-comment', handleSubmitCommentForm);
app.post('/internal/form/edit-post', handleEditPostForm);
app.post('/internal/form/select-template', handleSelectTemplateForm);
app.post('/internal/form/submit-template', handleSubmitTemplateForm);
app.post('/internal/form/edit-comment', handleEditCommentForm);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});