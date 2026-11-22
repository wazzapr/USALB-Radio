const RADIO_PAGE = "https://usalbradio.radiostream321.com/";
const RADIO_ID = "3409298";
const RADIO_ORIGIN = new URL(RADIO_PAGE).origin;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RadioStreamTarget {
  url: string;
  cookie?: string;
}

export async function fetchStreamTarget(): Promise<RadioStreamTarget> {
  const res = await fetch(RADIO_PAGE, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Radio page returned ${res.status}`);
  const html = await res.text();

  // Listen2MyRadio publishes the current rotating MP3 mount in its page source.
  const match = html.match(/https?:\\/\\/[^\\s"<>]+\\.mp3[^\\s"<>]*/i)
    ?? html.match(/https?:\\/\\/[^\\s"<>]+listen2myradio[^\\s"<>]*/i);

  if (!match) throw new Error("Stream URL not found in page source");

  return {
    url: match[0].replace(/&amp;/g, "&"),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}

export async function wakeRadioStation(cookie?: string): Promise<void> {
  // Mirror the provider's official listener-confirmation request.
  const response = await fetch(
    new URL(`openfire.ajax.php?radio_id=${RADIO_ID}`, RADIO_PAGE),
    {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept": "text/html, */*; q=0.01",
        "Referer": RADIO_PAGE,
        "Origin": RADIO_ORIGIN,
        "X-Requested-With": "XMLHttpRequest",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Radio warm-up returned ${response.status}`);
}

export async function openFreshRadioAudio(): Promise<{
  response: Response;
  controller: AbortController;
}> {
  let lastError: unknown;

  // The provider can rotate its mount or briefly return an HTML placeholder.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    try {
      const target = await fetchStreamTarget();
      await wakeRadioStation(target.cookie);

      const timeout = setTimeout(() => controller.abort(), 12000);
      let response: Response;
      try {
        response = await fetch(target.url, {
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            "Referer": RADIO_PAGE,
            "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
            ...(target.cookie ? { Cookie: target.cookie } : {}),
          },
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        response.ok
        && response.body
        && contentType.toLowerCase().startsWith("audio/")
      ) {
        return { response, controller };
      }

      await response.body?.cancel();
      lastError = new Error("Radio provider did not return audio");
      controller.abort();
    } catch (error) {
      controller.abort();
      lastError = error;
    }

    if (attempt < 3) await wait(1000);
  }

  throw new Error("Radio stream is unavailable", { cause: lastError });
}
