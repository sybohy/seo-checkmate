#!/usr/bin/env node

const Crawler = require("crawler");
const yargs = require("yargs");
const url = require("url");
const Table = require("cli-table3");
const chalk = require("chalk");
const axios = require("axios");
const xml2js = require("xml2js");
const ProgressBar = require("progress");

const args = yargs
  .option("site", {
    alias: "s",
    describe: "The website to crawl",
    type: "string",
    default: "localhost",
  })
  .option("port", {
    alias: "p",
    describe: "Port for the localhost",
    type: "number",
    default: 80,
  })
  .option("restrictions", {
    alias: "r",
    describe: "Restrictions for the crawler",
    type: "string",
    default: "no-external,no-subdomain",
  })
  .option("verbose", {
    alias: "v",
    describe: "Enable verbose output",
    type: "boolean",
    default: false,
  })
  .argv;

if (!args.site.startsWith("http://") && !args.site.startsWith("https://")) {
  args.site = `http://${args.site}`;
}

if (args.site === "http://localhost" || args.site === "https://localhost") {
  args.site += `:${args.port}`;
}

const mainDomain = url.parse(args.site).hostname;

const isSubdomain = (url) => {
  const hostname = new URL(url).hostname;
  if (hostname === mainDomain) return false;
  return hostname.endsWith(`.${mainDomain}`);
};

const isExternalDomain = (url) => {
  const hostname = new URL(url).hostname;
  return hostname !== mainDomain;
};

const isPdfUrl = (url) => {
  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;
  return pathname.endsWith('.pdf');
};

const crawledUrls = new Set();
const brokenLinks = [];

const progressBar = new ProgressBar(
  "Crawling [:bar] :percent (:current/:total URLs)",
  { total: 1, width: 30 }
);

const crawler = new Crawler({
  maxConnections: 10,
  rateLimit: 100,
  jQuery: 'cheerio',
  callback: (error, res, done) => {
    if (error) {
      console.log(`Error: ${error}`);
    } else {
      const contentType = res.headers["content-type"];
      const origin = res.options.uri;

      if (args.verbose) {
        console.log(`Fetched URL: ${origin} (Status: ${res.statusCode})`);
      }

      if (res.statusCode === 404) {
        brokenLinks.push(origin);
        // console.log(`Broken link (404): ${origin}`);
      }

      if (contentType && contentType.includes("text/html")) {
        const $ = res.$;

        $("a[href]").each(async (_, link) => {
          const href = link.attribs.href;
          if (href.startsWith("/") || href.startsWith(args.site)) {
            const fullUrl = href.startsWith("/")
              ? `${args.site}${href}`
              : href;
        
            if (
              (!args.restrictions.includes("no-subdomain") || !isSubdomain(fullUrl)) &&
              (!args.restrictions.includes("no-external") || !isExternalDomain(fullUrl))
            ) {
              if (!crawledUrls.has(fullUrl)) {
                crawledUrls.add(fullUrl);
        
                if (isPdfUrl(fullUrl)) {
                  // If the URL points to a PDF file, fetch it using axios and check the status code
                  try {
                    const response = await axios.head(fullUrl);
                    if (response.status === 404) {
                      brokenLinks.push(fullUrl);
                      if (args.verbose) {
                        console.log(`Broken link (404): ${fullUrl}`);
                      }
                    }
                  } catch (error) {
                    if (args.verbose) {
                      console.log(`Error fetching PDF: ${fullUrl} - ${error.message}`);
                    }
                  }
                } else {
                  // If the URL does not point to a PDF file, add it to the crawler queue
                  crawler.queue(fullUrl);
                }
              }
            }
          }
        });
      }
    }
    done();
  },
});

crawler.on("drain", () => {
  progressBar.terminate();

  const summaryTable = new Table({
    head: [
      chalk.blue("Crawled URLs"),
      chalk.green("OK URLs (200)"),
      chalk.red("Broken URLs (404)"),
    ],
  });

  const okUrlsCount = crawledUrls.size - brokenLinks.length;

  summaryTable.push([crawledUrls.size, okUrlsCount, brokenLinks.length]);

  console.log("\nCrawling completed. Summary:");
  console.log(summaryTable.toString());

  const brokenLinksTable = new Table({
    head: ["Error", "Link"],
  });

  brokenLinks.forEach((link) => brokenLinksTable.push(["404", link]));

  console.log("Broken links list:");
  console.log(brokenLinksTable.toString());
});

crawler.queue(args.site);

crawler.on("schedule", (options) => {
  if (!args.verbose) {
    progressBar.total++;
  }
});

crawler.on("request", () => {
  if (!args.verbose) {
    progressBar.tick();
  }
});