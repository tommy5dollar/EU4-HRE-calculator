const fs = require(`fs-extra`)
const zip = require(`extract-zip`)
const jomini = require(`jomini`)
const fetch = require(`node-fetch`)
const yaml = require(`json-to-pretty-yaml`)

const saveMap = require(`./saveMap`)
const players = require(`./players`)

const fullProvinceList = require(`./fullProvinceList`)

const showDebug = true

const excludeRegionList = [`Anatolia`, `Caucasia`, `Ural`]

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

  const enhancedScoreData = Object.values(scoreData).map(({ playerName, ...rest }) => ({
    ...rest,
    playerName,
    totalScore: totalScores[playerName]
  }))

  scoreData.sort(({ totalScore: totalScoreA, score: scoreA, totalDev: totalDevA }, { totalScore: totalScoreB, score: scoreB, totalDev: totalDevB }) => totalScoreB > totalScoreA ? 1 : scoreB > scoreA ? 1 : scoreB < scoreA ? -1 : totalDevB > totalDevA ? 1 : -1)

  return yaml.stringify({
    sessionNumber,
    skanderbegUrl,
    scores: enhancedScoreData.reduce((acc, { playerName, totalDev, euroDev, areaScore, score, totalScore, debug }) => ({
      ...acc,
      [playerName]: {
        totalDev,
        euroDev,
        areaScore,
        sessionScore: score,
        totalScore,
        debug: showDebug ? debug : null
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

  const enhancedProvinceData = Object.entries(provinces).map(([id, province]) => ({
    id: parseInt(id.split(`-`).join(``)),
    geography: fullProvinceList.find(({ ID }) => ID === parseInt(id.split(`-`).join(``))),
    ...province
  }))

  const euroProvinceData = enhancedProvinceData.filter(({ geography: { Continent, Region } = {} }) => Continent === `Europe` && !excludeRegionList.includes(Region))

  const playersNations = Object.entries(players).map(([playerTag, playerName]) => ({
    playerName,
    nationTag: playerTag,
    subjectTags: diplomacy.dependency.filter(({ first, start_date, end_date }) => first === playerTag && (!start_date || start_date <= currentDate) && (!end_date || end_date > currentDate)).map(({ second }) => second)
  }))

  const scoreData = playersNations.map(({ playerName, nationTag, subjectTags }) => {
    const ownedEuroProvinces = euroProvinceData.filter(({owner}) => owner === nationTag || subjectTags.includes(owner))

    const euroDev = ownedEuroProvinces.reduce(sumScoreReducer, 0) + ownedEuroProvinces.filter(({hre}) => hre && !!hre).reduce(sumScoreReducer, 0)

    const ownedEuroProvincesByArea = ownedEuroProvinces.reduce((acc, { geography: { Area }, ...rest }) => ({
      ...acc,
      [Area]: [...(acc[Area] || []), rest]
    }), {})

    const scoresByArea = Object.entries(ownedEuroProvincesByArea).reduce((acc, [Area, ownedProvinces]) => {
      const unownedProvinces = euroProvinceData.filter(({geography: { Area: innerArea }, owner}) => Area === innerArea && owner !== nationTag && !subjectTags.includes(owner))

      const percentageOfAreaOwned = ownedProvinces.length / (ownedProvinces.length + unownedProvinces.length)

      const ownedProvincesDev = ownedProvinces.reduce(sumScoreReducer, 0)
      const unownedProvincesDev = unownedProvinces.reduce(sumScoreReducer, 0)

      const score = percentageOfAreaOwned >= 1 ? ownedProvincesDev : percentageOfAreaOwned < 0.5 ? unownedProvincesDev * -1 : 0
      acc[Area] = {
        score,
        debug: {
          percentageOwned: percentageOfAreaOwned * 100,
          ownedDev: ownedProvincesDev,
          unownedDev: unownedProvincesDev,
          score
        }
      }

      return acc
    }, {})

    const areaScore = Object.values(scoresByArea).map(({ score }) => score).reduce((acc, score) => acc + score, 0)

    return {
      playerName,
      tag: nationTag,
      totalDev: Object.values(provinces).filter(({owner}) => owner === nationTag || subjectTags.includes(owner)).reduce(sumScoreReducer, 0),
      euroDev,
      areaScore,
      score: areaScore * sessionNumber,
      debug: Object.entries(scoresByArea).reduce((acc, [name, { debug }]) => ({...acc, [name]: debug}), {})
    }
  }).sort(({ score: scoreA, totalDev: totalDevA }, { score: scoreB, totalDev: totalDevB }) => scoreB > scoreA ? 1 : scoreB < scoreA ? -1 : totalDevB > totalDevA ? 1 : -1)

  return {
    sessionNumber,
    skanderbegId,
    skanderbegUrl: `https://skanderbeg.pm/browse.php?id=${skanderbegId}`,
    scoreData
  }
}

const sumScoreReducer = (acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower

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