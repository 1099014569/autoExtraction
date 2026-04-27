import robotsParserModule from "robots-parser";

type RobotsParserFactory = (url: string, robotsBody: string) => {
  isAllowed: (targetUrl: string, userAgent: string) => boolean | undefined;
};

const robotsParser = robotsParserModule as unknown as RobotsParserFactory;

export const ensureRobotsAllowed = async (params: {
  targetUrl: string;
  userAgent: string;
}): Promise<void> => {
  const parsedUrl = new URL(params.targetUrl);
  const robotsUrl = `${parsedUrl.origin}/robots.txt`;

  let robotsText = "";
  try {
    const response = await fetch(robotsUrl, {
      headers: {
        "user-agent": params.userAgent
      }
    });
    if (response.ok) {
      robotsText = await response.text();
    }
  } catch {
    return;
  }

  if (!robotsText) {
    return;
  }

  const parser = robotsParser(robotsUrl, robotsText);
  const allowed = parser.isAllowed(params.targetUrl, params.userAgent);
  if (allowed === false) {
    throw new Error("目标站点 robots.txt 不允许抓取该 URL");
  }
};
