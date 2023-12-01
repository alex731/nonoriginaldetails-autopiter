const puppeteer = require("puppeteer");
const fs = require("fs").promises;
const path = require("path");

async function scrapeModels(page, brandLink, brandName, brandsFolderPath) {
  await page.goto(brandLink, { waitUntil: "domcontentloaded" });

  const models = await page.$$eval(
    ".AlphabetList__content___2spqv a",
    (elements) =>
      elements.map((element) => ({
        name: element.textContent.trim(),
        link: element.getAttribute("href"),
      }))
  );

  const outputFilePath = path.join(brandsFolderPath, `${brandName}.json`);

  let brandData = {};
  try {
    const existingData = await fs.readFile(outputFilePath, "utf-8");
    brandData = JSON.parse(existingData);
  } catch (error) {
    console.log(error);
  }

  brandData[brandName] = {
    link: brandLink,
    models: {},
  };

  for (const model of models) {
    const modelLink = "https://autopiter.ru" + model.link;

    const submodels = await scrapeSubmodels(page, modelLink);

    for (const submodel of submodels) {
      const submodelLink = submodel.link;
      submodel.parts = await scrapeParts(page, submodelLink);
    }

    brandData[brandName].models[model.name] = {
      link: modelLink,
      submodels,
    };
  }

  const jsonData = JSON.stringify(brandData, null, 2);
  await fs.writeFile(outputFilePath, jsonData, "utf-8");
  console.log(`Модели бренда ${brandName} записаны в`, outputFilePath);
}

async function scrapeBrands(page, brandListUrl) {
  await page.goto(brandListUrl, { waitUntil: "domcontentloaded" });

  return page.$$eval(".AlphabetList__content___2spqv a", (elements) =>
    elements.map((element) => ({
      name: element.textContent.trim(),
      link: element.getAttribute("href"),
    }))
  );
}

async function scrapeSubmodels(page, modelLink) {
  await page.goto(modelLink, { waitUntil: "domcontentloaded" });

  return page.$$eval(".MobileTable__items___19_GW", async (elements) => {
    return Promise.all(
      elements.map(async (element) => {
        const submodelData = {};
        const linkElement = element.querySelector(
          ".MobileTable__arrowIcon___1mNw2"
        );
        const link = linkElement
          ? "https://autopiter.ru" +
            linkElement.parentElement.getAttribute("href")
          : "";

        element
          .querySelectorAll(".MobileTable__item___318Jx")
          .forEach((item) => {
            const titleElement = item.querySelector(
              ".MobileTable__itemTitle___11AHD"
            );
            const valueElement = item.querySelector(
              ".MobileTable__itemValue___hcia7"
            );
            if (titleElement && valueElement) {
              const title = titleElement.textContent.trim();
              const value = valueElement.textContent.trim();
              submodelData[title] = value;
            }
          });

        submodelData.link = link;

        return submodelData;
      })
    );
  });
}

async function scrapeParts(page, submodelLink) {
  await page.goto(submodelLink, { waitUntil: "domcontentloaded" });

  const extractCategoryData = async (page, categoryElement) => {
    const button = await categoryElement.$(".TreeNode__label___28j8R");
    await page.evaluate((btn) => btn.click(), button);
    await page.waitForTimeout(300);
    const categoryData = {
      name: await page.evaluate(
        (el) =>
          el.querySelector(".TreeNode__title___2rsvp")?.textContent.trim() ||
          "",
        categoryElement
      ),
      subcategories: [],
      links: [],
    };

    try {
      const links = await categoryElement.$$eval(
        ".ItemLink__itemLink___2g1RR",
        (links) =>
          links.map((link) => ({
            name: link.textContent,
            link: link.href,
          }))
      );

      const partsPromises = links.map(async (link) => {
        try {
          link.parts = await scrapePartsDetails(page, link.link);
        } catch (err) {
          console.error(`Error navigating to ${link.link}: ${err}`);
        }
      });

      await Promise.all(partsPromises);

      categoryData.links.push(...links);

      const subcategoryElements = await categoryElement.$$(
        ".TreeNode__wrapper___8AFSc"
      );

      categoryData.subcategories = await Promise.all(
        subcategoryElements.map(async (subcategoryElement) => {
          return await extractCategoryData(page, subcategoryElement);
        })
      );
    } catch (error) {
      console.error("Error while extracting links:", error);
    }

    await page.evaluate((el) => el.click(), button);
    await page.waitForTimeout(300);
    return categoryData;
  };

  const categoryElements = await page.$$(".TreeNode__wrapper___8AFSc");
  const categories = [];

  for (let i = 0; i < categoryElements.length; i++) {
    const categoryElement = categoryElements[i];
    const categoryData = await extractCategoryData(page, categoryElement);
    categories.push(categoryData);
  }

  return categories;
}

async function scrapePartsDetails(page, partsLink) {
  const browserContext = await page.browser().createIncognitoBrowserContext();
  const contextPage = await browserContext.newPage();

  try {
    await contextPage.goto(partsLink, { waitUntil: "domcontentloaded" });

    const details = await contextPage.evaluate(() => {
      const items = document.querySelectorAll(".MobileTable__items___19_GW");

      return Array.from(items).map((item) => {
        const nameElement = item.querySelector(
          ".CatalogMobileTable__name___3grBb > .CatalogMobileTable__value___2lue8"
        );
        const name = nameElement ? nameElement.textContent : null;

        const parameters = Array.from(
          item.querySelectorAll(".NonOriginalPartsTable__parameters___z8AHR li")
        ).map((parameterElement) => {
          const keyElement = parameterElement.querySelector(".tcTxt");
          const valueElement = parameterElement.querySelector(".tcVal");

          const key = keyElement ? keyElement.textContent.trim() : null;
          const value = valueElement ? valueElement.textContent.trim() : null;

          return { key, value };
        });

        return { name, parameters };
      });
    });

    return details;
  } finally {
    await contextPage.close();
    await browserContext.close();
  }
}

(async () => {
  const startBrandNumber = 5; //с какого номера
  const endBrandNumber = 10; //по какой, всего 577
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.google.com/",
  });

  const brandListUrl = "https://autopiter.ru/nonoriginaldetails";
  const brandsFolderPath = path.join(__dirname, "brands");
  await fs.mkdir(brandsFolderPath, { recursive: true });

  const brands = await scrapeBrands(page, brandListUrl);

  const selectedBrands = brands.slice(startBrandNumber - 1, endBrandNumber);

  for (const brand of selectedBrands) {
    const brandLink = "https://autopiter.ru" + brand.link;
    await scrapeModels(page, brandLink, brand.name, brandsFolderPath);
  }

  await browser.close();
})();
