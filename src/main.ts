import { PLAPI, PLExtAPI, PLExtension } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "@future-scholars/metadata-pipeline";
import parse from "node-html-parser";


const thumIcon = `
<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" class="bi bi-hand-thumbs-up my-auto" viewBox="0 0 16 16">
  <path d="M8.864.046C7.908-.193 7.02.53 6.956 1.466c-.072 1.051-.23 2.016-.428 2.59-.125.36-.479 1.013-1.04 1.639-.557.623-1.282 1.178-2.131 1.41C2.685 7.288 2 7.87 2 8.72v4.001c0 .845.682 1.464 1.448 1.545 1.07.114 1.564.415 2.068.723l.048.03c.272.165.578.348.97.484.397.136.861.217 1.466.217h3.5c.937 0 1.599-.477 1.934-1.064a1.86 1.86 0 0 0 .254-.912c0-.152-.023-.312-.077-.464.201-.263.38-.578.488-.901.11-.33.172-.762.004-1.149.069-.13.12-.269.159-.403.077-.27.113-.568.113-.857 0-.288-.036-.585-.113-.856a2 2 0 0 0-.138-.362 1.9 1.9 0 0 0 .234-1.734c-.206-.592-.682-1.1-1.2-1.272-.847-.282-1.803-.276-2.516-.211a10 10 0 0 0-.443.05 9.4 9.4 0 0 0-.062-4.509A1.38 1.38 0 0 0 9.125.111zM11.5 14.721H8c-.51 0-.863-.069-1.14-.164-.281-.097-.506-.228-.776-.393l-.04-.024c-.555-.339-1.198-.731-2.49-.868-.333-.036-.554-.29-.554-.55V8.72c0-.254.226-.543.62-.65 1.095-.3 1.977-.996 2.614-1.708.635-.71 1.064-1.475 1.238-1.978.243-.7.407-1.768.482-2.85.025-.362.36-.594.667-.518l.262.066c.16.04.258.143.288.255a8.34 8.34 0 0 1-.145 4.725.5.5 0 0 0 .595.644l.003-.001.014-.003.058-.014a9 9 0 0 1 1.036-.157c.663-.06 1.457-.054 2.11.164.175.058.45.3.57.65.107.308.087.67-.266 1.022l-.353.353.353.354c.043.043.105.141.154.315.048.167.075.37.075.581 0 .212-.027.414-.075.582-.05.174-.111.272-.154.315l-.353.353.353.354c.047.047.109.177.005.488a2.2 2.2 0 0 1-.505.805l-.353.353.353.354c.006.005.041.05.041.17a.9.9 0 0 1-.121.416c-.165.288-.503.56-1.066.56z"/>
</svg>
`

class PaperlibCommunityCommentsExtension extends PLExtension {
  disposeCallbacks: (() => void)[];
  private _APIURL: string = "";
  private _APIURLTimestamp: number = 0;

  constructor() {
    super({
      id: "@future-scholars/paperlib-community-comments-extension",
      defaultPreference: {},
    });

    this.disposeCallbacks = [];
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference
    );

    this.disposeCallbacks.push(
      PLAPI.uiStateService.onChanged("selectedPaperEntities", (newValues) => {
        if (newValues.value.length === 1) {
          this.getCommunityComments(newValues.value[0]);
        }
      })
    );
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }

    PLExtAPI.extensionPreferenceService.unregister(this.id);
  }

  async getCommunityComments(paperEntity: PaperEntity) {
    const lang = await PLAPI.preferenceService.get("language") as string;
    const title = lang === "zh-CN" ? "社区评论" : "Community Comments";

    await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot3", {
      "paperlib-community-comments": {
        title: title,
        content: `N/A`,
      },
    });

    try {
      const commentsFromAlphaXiv = await this.getFromAlphaXiv(paperEntity, lang);
      PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot3", {
        "paperlib-community-comments": {
          title: title,
          content: commentsFromAlphaXiv.trim() || "N/A",
        },
      });
    } catch (err) {
      if ((err as Error).message.includes("404")) {
        PLAPI.logService.warn(
          "Failed to get community comments",
          "",
          false,
          "CommunityCommentsExt"
        );
        return;
      }
      PLAPI.logService.error(
        "Failed to get community comments",
        err as Error,
        false,
        "CommunityCommentsExt"
      );
    }
  }

  async getFromAlphaXiv(paperEntity: PaperEntity, lang: string) {
    if (stringUtils.isEmpty(paperEntity.arxiv)) {
      return "";
    }

    try {
      const htmlResponse = await PLExtAPI.networkTool.get(
        "https://alphaxiv.org/",
        {},
        1,
        5000,
        false,
        true
      );
      const html = parse(htmlResponse.body);
      const allScripts = html.querySelectorAll("script");
      for (const script of allScripts) {
        // Get src
        const src = script.getAttribute("src");
        if (!src?.startsWith("/_next/static/chunks/")) {
          continue;
        }

        // Get content
        const response = await PLExtAPI.networkTool.get(
          `https://alphaxiv.org${src}`,
          {},
          1,
          5000,
          false,
          true
        );
        const content = response.body as string;

        // Find API URL if past 1 hours, such as: xxxxxxxx.execute-api.us-west-2.amazonaws.com/default
        if (Date.now() - this._APIURLTimestamp > 3600000) {
          const apiURL = content.match(
            /https:\/\/[a-zA-Z0-9\-]+\.execute-api\.[a-zA-Z0-9\-]+\.amazonaws\.com\/default/g
          );
          if (!apiURL) {
            continue;
          } else {
            this._APIURL = apiURL[0];
            this._APIURLTimestamp = Date.now();
          }
        }

        if (!this._APIURL) {
          continue;
        } else {
          // get latest version: https://9lb0a7uylk.execute-api.us-west-2.amazonaws.com/default/papers/latestversion/2406.07394
          const latestVersionResponse = await PLExtAPI.networkTool.get(
            `${this._APIURL}/papers/latestversion/${paperEntity.arxiv.replaceAll("arxiv:", "")}`,
            {},
            1,
            5000,
            false,
            true
          );
          const latestVersion = latestVersionResponse.body.version;

          const response = await PLExtAPI.networkTool.post(
            `${this._APIURL}/papers/questions/${latestVersion}/true`,
            {"tags": null},
            {},
            1,
            5000,
            false,
            true
          );
          
          interface IComment {
            date: string;
            body: string;
            upvotes: number;
            author: string;
            institution?: string,
            responses?: IComment[]
          }
          const data = response.body as {
            "bodyarr": IComment[]
          }

          if (data.bodyarr.length === 0) {
            return `<div class='flex mt-1'>
                      <div class='flex space-x-1 bg-neutral-200 dark:bg-neutral-700 rounded-md p-1 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:shadow-sm select-none cursor-pointer'>
                        <a href='https://alphaxiv.org/abs/${latestVersion}'>${lang === 'zh-CN' ? '评论' : 'Post'}</a>
                      </div>
                    </div>`;
          }

          const commentsBody = data.bodyarr.map((comment) => {
            return `
            <div class='flex flex-col text-justify pr-2 py-2'>
              <div class='flex flex-col'>
                <div class='flex justify-between'>
                  <div class='font-semibold my-auto'>${comment.author + (comment.institution ? '@' + comment.institution : '')}</div>
                  <div class='my-auto flex space-x-1'>
                    ${comment.upvotes > 0 ? thumIcon + '<span>' + comment.upvotes + '</span>' : ''}
                  </div>
                </div>

                <div class='flex space-x-2 text-neutral-400'>
                  <div>alphaxiv.org</div>
                  <div >${(new Date(comment.date).toLocaleDateString())}</div>
                </div>
              </div>
              <div class='dark:text-neutral-300'><a href=https://alphaxiv.org/abs/${latestVersion}>${comment.body.replace(/style=".*?"/g, "")}</a></div>
              <div class='flex flex-col pl-6 ${comment.responses && comment.responses.length > 0 ? 'pt-2' : ''}'>
                ${comment.responses ? comment.responses.map((response) => {
                  return `
                  <div class='flex flex-col text-justify'>
                    <div class='flex justify-between'>
                      <div class='my-auto font-semibold'>${response.author}</div>
                      <div class='my-auto flex space-x-1'>
                        ${response.upvotes > 0 ? thumIcon + '<span>' + response.upvotes + '</span>' : ''}
                      </div>
                    </div>
                    <div class='dark:text-neutral-300'><a href=https://alphaxiv.org/abs/${latestVersion}>${comment.body.replace(/style=".*?"/g, "")}</a></div>
                  </div>`;
                }).join("<div class='dark:bg-neutral-700 bg-neutral-300 h-[1px] w-full my-2'></div>") : ''}
              </div>
            </div>
            `
          }).join("<div class='dark:bg-neutral-700 bg-neutral-300 h-[1px] w-full'></div>");

          return `<div class='flex flex-col mt-1'>
                    <div class='flex'>
                      <div class='flex space-x-1 bg-neutral-200 dark:bg-neutral-700 rounded-md p-1 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:shadow-sm select-none cursor-pointer'>
                        <a href='https://alphaxiv.org/abs/${latestVersion}'>${lang === 'zh-CN' ? '评论' : 'Post'}</a>
                      </div>
                    </div>
                    <div class='flex flex-col space-y-2'>${commentsBody}</div>
                  </div>
`;
        }

      }

      return "";

    } catch (err) {
      PLAPI.logService.error(
        "Failed to get data from alphaxiv.org",
        err as Error,
        false,
        "CommunityCommentsExt"
      );
      return "";
    }
  }
}

async function initialize() {
  const extension = new PaperlibCommunityCommentsExtension();
  await extension.initialize();

  return extension;
}

export { initialize };