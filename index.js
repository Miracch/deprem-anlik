// 1. Gerekli modülleri import ediyoruz
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import { format } from "date-fns";
import { tr } from "date-fns/locale/tr";

// 2. Ortam değişkenlerini yüklüyoruz (.env dosyasından)
dotenv.config();

// 3. Telegram botunu başlatıyoruz
const token = "7928408572:AAHlhitvPtIXbEGQTapVDnW145a7UQDDFB0" || "YEDEK_TOKEN";
const bot = new TelegramBot(token, { polling: true });
const CHAT_ID = "1742523198" || "SOHBET_ID";

// 4. Yapılandırma ayarları
const CONFIG = {
  checkIntervalSeconds: 30, // 30 saniyede bir kontrol
  lastQuakesFile: "last_quakes.json", // Bildirilen depremleri kaydedeceğimiz dosya
  userSettingsFile: "user-settings.json", // Kullanıcıların şehir seçimlerini tutacağımız dosya
};

// 5. Şehir listesi
const availableCities = [
  "İstanbul",
  "Kocaeli",
  "Sakarya",
  "Bursa",
  "İzmir",
  "Balıkesir",
  "Çanakkale",
  "Tekirdağ",
  "Yalova",
  "Manisa",
  "Aydın",
  "Muğla",
  "Denizli",
  "Gaziantep",
  "Hatay",
];

// 6. Hafıza alanları
let lastCheckedQuakes = new Set();
const userSelections = {}; // geçici seçim alanı

// 7. Depremleri dosyadan yükleme fonksiyonu
async function loadLastCheckedQuakes() {
  try {
    const data = await fs.readFile(CONFIG.lastQuakesFile, "utf-8");
    const ids = JSON.parse(data);
    lastCheckedQuakes = new Set(ids);
    console.log(`Önceki ${ids.length} deprem kaydı yüklendi.`);
  } catch (error) {
    console.log("Önceki deprem kaydı bulunamadı, yeni Set başlatıldı.");
  }
}

// 8. Depremleri dosyaya kaydetme fonksiyonu
async function saveLastCheckedQuakes() {
  try {
    const ids = Array.from(lastCheckedQuakes);
    await fs.writeFile(CONFIG.lastQuakesFile, JSON.stringify(ids, null, 2));
  } catch (error) {
    console.error("Kayıt dosyası yazılamadı:", error);
  }
}

// 9. Kullanıcı ayarlarını yükleme/kaydetme
async function loadUserSettings() {
  try {
    const data = await fs.readFile(CONFIG.userSettingsFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveUserSettings(chatId, cities) {
  try {
    let settings = {};
    try {
      const fileContent = await fs.readFile(CONFIG.userSettingsFile, "utf-8");
      settings = JSON.parse(fileContent);
    } catch {}

    settings[chatId] = cities;
    await fs.writeFile(
      CONFIG.userSettingsFile,
      JSON.stringify(settings, null, 2)
    );
  } catch (error) {
    console.error("Kullanıcı ayarları kaydedilemedi:", error);
  }
}

// 10. Web sitesinden deprem verilerini çekme
async function getEarthquakeDataFromWeb() {
  try {
    const response = await fetch(
      "https://deprem.afad.gov.tr/last-earthquakes.html"
    );
    const html = await response.text();
    const $ = cheerio.load(html);

    const earthquakes = [];

    $("table tbody tr").each((i, row) => {
      const columns = $(row).find("td");
      if (columns.length >= 7) {
        const date = $(columns[0]).text().trim();
        const latitude = $(columns[1]).text().trim();
        const longitude = $(columns[2]).text().trim();
        const depth = $(columns[3]).text().trim();
        const magType = $(columns[4]).text().trim();
        const magnitude = $(columns[5]).text().trim();
        const location = $(columns[6]).text().trim();

        const eventID = `${date}-${latitude}-${longitude}`;

        earthquakes.push({
          eventID,
          date,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          depth: parseFloat(depth),
          magType,
          magnitude: parseFloat(magnitude),
          location,
        });
      }
    });

    return earthquakes;
  } catch (error) {
    console.error("Deprem verisi çekilirken hata oluştu:", error);
    return [];
  }
}

// 11. Deprem mesajı formatlama
function formatEarthquakeMessage(quake) {
  return `⚡ *Yeni Deprem* ⚡\n
📍 *Yer:* ${quake.location}
📊 *Büyüklük:* ${quake.magnitude} ${quake.magType}
🔻 *Derinlik:* ${quake.depth} km
🕰️ *Tarih:* ${quake.date}
🌎 *Koordinatlar:* ${quake.latitude}, ${quake.longitude}`;
}

// 12. Depremleri kontrol ve bildirim
async function checkAndNotify() {
  console.log(
    `[${new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    })}] Deprem kontrolü yapılıyor...`
  );

  try {
    const earthquakes = await getEarthquakeDataFromWeb();
    const userSettings = await loadUserSettings();

    if (!earthquakes || earthquakes.length === 0) {
      console.log("Deprem verisi bulunamadı.");
      return;
    }

    for (const quake of earthquakes) {
      if (!lastCheckedQuakes.has(quake.eventID)) {
        lastCheckedQuakes.add(quake.eventID);

        for (const [chatId, cities] of Object.entries(userSettings)) {
          for (const city of cities) {
            if (quake.location.includes(city)) {
              const message = formatEarthquakeMessage(quake);
              await bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
              });
              break;
            }
          }
        }
      }
    }

    await saveLastCheckedQuakes();
  } catch (error) {
    console.error("checkAndNotify() hatası:", error);
  }
}
bot.onText(/\/sehirlerim/, async (msg) => {
  const chatId = msg.chat.id;
  const userSettings = await loadUserSettings();

  const cities = userSettings[chatId];

  if (!cities || cities.length === 0) {
    bot.sendMessage(chatId, "📭 Şu anda seçili bir şehriniz bulunmamaktadır.");
    return;
  }

  const inlineKeyboard = cities.map((city) => [
    { text: `❌ ${city}`, callback_data: `remove_${city}` },
  ]);

  bot.sendMessage(chatId, "📍 Şu anda seçtiğiniz şehirler:", {
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
});
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("remove_")) {
    const cityToRemove = data.replace("remove_", "");

    const userSettings = await loadUserSettings();

    if (!userSettings[chatId]) {
      bot.answerCallbackQuery(query.id, { text: "❌ Şehir bulunamadı." });
      return;
    }

    const updatedCities = userSettings[chatId].filter(
      (city) => city !== cityToRemove
    );

    userSettings[chatId] = updatedCities;

    await fs.writeFile(
      CONFIG.userSettingsFile,
      JSON.stringify(userSettings, null, 2)
    );

    if (updatedCities.length > 0) {
      bot.editMessageText(
        `✅ ${cityToRemove} şehri çıkarıldı. Kalan şehirler:\n\n${updatedCities.join(
          ", "
        )}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: updatedCities.map((city) => [
              { text: `❌ ${city}`, callback_data: `remove_${city}` },
            ]),
          },
        }
      );
    } else {
      bot.editMessageText(
        `📭 Tüm şehirler kaldırıldı. Yeni şehir eklemek için yeniden botla iletişime geçebilirsin.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
        }
      );
    }

    bot.answerCallbackQuery(query.id, {
      text: `✅ ${cityToRemove} çıkarıldı.`,
    });
  }
});
// 13. Yeni kullanıcı geldiğinde Hoşgeldin + şehir seçimi
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  const userSettings = await loadUserSettings();

  if (!userSettings[chatId]) {
    if (!userSelections[chatId]) {
      bot.sendMessage(
        chatId,
        `👋 Merhaba, AFAD Deprem Bilgilendirme Botuna hoş geldiniz!\n\nLütfen hangi şehirlerden deprem bildirimi almak istediğinizi seçin.\n(Seçimler bittikten sonra "✅ Seçimi Bitir" butonuna basın.)`,
        {
          reply_markup: {
            keyboard: [
              ...availableCities.map((city) => [{ text: city }]),
              [{ text: "✅ Seçimi Bitir" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: false,
          },
        }
      );

      userSelections[chatId] = new Set();
    } else {
      if (text === "✅ Seçimi Bitir") {
        if (userSelections[chatId].size === 0) {
          bot.sendMessage(
            chatId,
            "⛔ Hiç şehir seçmediniz. Lütfen bir şehir seçin."
          );
          return;
        }

        const selectedCities = Array.from(userSelections[chatId]);
        await saveUserSettings(chatId, selectedCities);

        bot.sendMessage(
          chatId,
          `✅ Şehir seçiminiz kaydedildi: ${selectedCities.join(
            ", "
          )}\nArtık bu şehirlerde deprem olunca bildirim alacaksınız.`,
          {
            reply_markup: {
              remove_keyboard: true,
            },
          }
        );

        delete userSelections[chatId];
      } else if (availableCities.includes(text)) {
        userSelections[chatId].add(text);
        bot.sendMessage(
          chatId,
          `✅ ${text} eklendi. Başka şehir seçebilir veya "✅ Seçimi Bitir" diyebilirsiniz.`
        );
      }
    }
  }
});

// 14. Botu başlat
(async () => {
  console.log("AFAD Web Deprem Bildirim Botu başlatılıyor...");

  await loadLastCheckedQuakes();
  await checkAndNotify();

  setInterval(checkAndNotify, CONFIG.checkIntervalSeconds * 1000);
})();
