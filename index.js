const fs = require(`fs-extra`)
const zip = require(`extract-zip`)
const jomini = require(`jomini`)
const fetch = require(`node-fetch`)
const yaml = require(`json-to-pretty-yaml`)

const saveMap = require(`./saveMap`)
const players = require(`./players`)

const processAllScores = async () => {
  const { apiKey, saves } = saveMap

  const allScoreData = fs.readJsonSync(`./scores.json`)

  const unscoredSessions = Object.entries(saves).filter(([sessionNum]) => !allScoreData[sessionNum])

  await Promise.all(unscoredSessions.map(([, skanderbegId]) => fetchSaveFromSkanderbeg(apiKey, skanderbegId)))

  const scoreDataToWrite = await unscoredSessions.reduce(async (acc, [sessionNumber, skanderbegId]) => {
    acc = await acc

    acc[sessionNumber] = await processScore(skanderbegId, sessionNumber)

    return acc
  }, Promise.resolve(allScoreData))

  const newScoreData = Object.values(scoreDataToWrite).reduce((acc, { sessionNumber, ...rest }) => {
    scoreDataToWrite[sessionNumber] = { ...rest, sessionNumber }

    return scoreDataToWrite
  }, scoreDataToWrite)

  fs.writeJsonSync(`./scores.json`, newScoreData)

  const latestSessionNumber = Object.keys(newScoreData).reduce((acc, sessionNumber) => parseInt(sessionNumber, 10) > acc ? parseInt(sessionNumber, 10) : acc, 0)

  const totalScores = Object.values(newScoreData).flatMap(({ scoreData }) => scoreData).reduce((acc, { playerName, score }) => ({
    ...acc,
    [playerName]: acc[playerName] ? acc[playerName] + score : score
  }), {})

  const { sessionNumber, skanderbegUrl, scoreData } = newScoreData[latestSessionNumber]

  scoreData.sort(({ score: scoreA, totalDev: totalDevA }, { score: scoreB, totalDev: totalDevB }) => scoreB > scoreA ? 1 : scoreB < scoreA ? -1 : totalDevB > totalDevA ? 1 : -1)

  return yaml.stringify({
    sessionNumber,
    skanderbegUrl,
    scores: Object.values(scoreData).reduce((acc, { playerName, tag, scorableDev, totalDev, score }) => ({
      ...acc,
      [playerName]: {
        scorableDev,
        sessionScore: score,
        totalDev,
        totalScore: totalScores[playerName]
      }
    }), {})
  })
}

const processScore = async (skanderbegId, sessionNumber) => {
  await zip(`./${skanderbegId}.eu4`, { dir: __dirname })

  const gamestateString = fs.readFileSync(`./gamestate`).toString(`utf8`)
  const metaString = fs.readFileSync(`./meta`).toString(`utf8`)

  const fixedGamestateString = gamestateString
    .split(`map_area_data{`).join(`map_area_data={`)

  const { date: currentDate } = jomini.parse(metaString)
  const gamestateParsed = jomini.parse(fixedGamestateString)
  const { provinces, diplomacy } = gamestateParsed

  const playersNations = Object.entries(players).map(([playerTag, playerName]) => ({
    playerName,
    nationTag: playerTag,
    subjectTags: diplomacy.dependency.filter(({ first, start_date, end_date }) => first === playerTag && (!start_date || start_date <= currentDate) && (!end_date || end_date > currentDate)).map(({ second }) => second)
  }))

  const euroProvinceData = Object.entries(provinces).filter(([ id ], i) => euroProvinces.includes(parseInt(id.split(`-`).join(``), 10))).map(([, province]) => province)
  const hreProvinces = Object.values(provinces).filter(({ hre }) => hre && !!hre)

  const scoreData = playersNations.map(({ playerName, nationTag, subjectTags }) => {
    const scorableDev = euroProvinceData.filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + euroProvinceData.filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + hreProvinces.filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + hreProvinces.filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)

    return {
      playerName,
      tag: nationTag,
      scorableDev,
      totalDev: Object.values(provinces).filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
        + Object.values(provinces).filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0),
      score: scorableDev * sessionNumber,
      debug: {
        owned: euroProvinceData.filter(({owner}) => owner === nationTag).map(({name, base_tax, base_production, base_manpower}) => ({
          name,
          base_tax,
          base_production,
          base_manpower
        })),
        subjects: euroProvinceData.filter(({owner}) => subjectTags.includes(owner)).map(({name, base_tax, base_production, base_manpower}) => ({
          name,
          base_tax,
          base_production,
          base_manpower
        }))
      }
    }
  }).sort(({ score: scoreA, totalDev: totalDevA }, { score: scoreB, totalDev: totalDevB }) => scoreB > scoreA ? 1 : scoreB < scoreA ? -1 : totalDevB > totalDevA ? 1 : -1)

  return {
    sessionNumber,
    skanderbegId,
    skanderbegUrl: `https://skanderbeg.pm/browse.php?id=${skanderbegId}`,
    scoreData
  }
}

const fetchSaveFromSkanderbeg = async (apiKey, saveId) => {
  console.log(`Fetching ${saveId}`)

  const res = await fetch(`https://skanderbeg.pm/api.php?key=${apiKey}&scope=downloadSaveFile&id=${saveId}`)

  const writeStream = fs.createWriteStream(`./${saveId}.eu4`)

  res.body.pipe(writeStream)

  return new Promise(success => res.body.on(`finish`, success))
}

processAllScores()
  .then(console.log)
  .catch(console.log)