import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleUseTemplateMenu = async (c: Context) => {
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

  if (perms?.includes("posts") || perms?.includes("all")) {
    const t1name = (await settings.get("postTemplate1name")) as string;
    const t2name = (await settings.get("postTemplate2name")) as string;
    const t3name = (await settings.get("postTemplate3name")) as string;
    const t4name = (await settings.get("postTemplate4name")) as string;
    const t5name = (await settings.get("postTemplate5name")) as string;

    return c.json({
      showForm: {
        name: "selectTemplateForm",
        form: {
          title: "Use template",
          acceptLabel: "Select",
          cancelLabel: "Cancel",
          fields: [
            {
              name: "templateNumber",
              label: "Select template",
              type: "select",
              options: [
                { label: t1name, value: "template1" },
                { label: t2name, value: "template2" },
                { label: t3name, value: "template3" },
                { label: t4name, value: "template4" },
                { label: t5name, value: "template5" },
              ]
            }
          ]
        }
      }
    });
  } else {
    return c.json({ showToast: { text: "You don't have the necessary permissions." } });
  }
};