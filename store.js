/* globals Vue, Vuex */
const defaultTerminalStationNames = [
  'St. Pancras International',
  'London Victoria',
  'London Charing Cross',
  'London Bridge',
  'London Cannon Street',
  'London Blackfriars',
]
let id = 0

function calculateTableContents(table, fullBank, allServices) {
  // Identify target station
  const station = fullBank.find(station => station.id === table.target);

  // Start with bank including terminal stations and target station
  let bank = table.terminalStations
    .map(id => fullBank.find(station => station.id === id))
    .concat(station)
    .sort((a, b) => a.id - b.id)

  const bankIndicies = bank.map(station => fullBank.indexOf(station))

  // Only pull services which stop at target
  let services = allServices
    .filter(s => {
      // Check the service stops at the target
      const stopsAtTarget = !s.times[fullBank.indexOf(station)].isEmpty
      if (!stopsAtTarget) return false
      
      // Check the service stops at at-least-one terminal station
      const otherTerminalStops = table.terminalStations
        .filter(stationIndex => !s.times[stationIndex].isEmpty)
      
      return otherTerminalStops.length > 0
    })
    // Reduce service to just times relevant to bank
    .map(service => ({
      ...service,
      times: service.times
        .filter((time, index) => bankIndicies.includes(index))
        .map(time => Object.assign({}, time)),
    }))

  // If any stations aren't used, remove them from the bank and the services
  const removeStations = [];
  bank.forEach((station, index) => {
    if (services.every(service => service.times[index].isEmpty)) {
      removeStations.push(index)
    }
  })

  // Filter out removed stations
  bank = bank.filter((station, index) => !removeStations.includes(index))
  services = services.map(service => ({
    ...service,
    times: service.times.filter((timing, index) => !removeStations.includes(index)).slice()
  }))

  return {bank, services}
}

const store = new Vuex.Store({ // eslint-disable-line no-unused-vars
  state: {
    bank: {},
    services: {},
    tables: [],
  },
  mutations: {
    LOAD_BANK (state, bank) {
      state.bank = bank
    },
    LOAD_SERVICES (state, services) {
      state.services = services
    },
    ADD_TABLE (state, table) {
      // Set terminal stations
      table.terminalStations = state.bank
        .filter(station => station.id !== table.target && defaultTerminalStationNames.includes(station.name))
        .map(station => station.id)

      // Add table to Vuex
      table.id = id++;
      state.tables.push(table)

      const { bank, services } = calculateTableContents(table, state.bank, state.services)
      Vue.set(table, 'bank', bank)
      Vue.set(table, 'services', services)
    },
    TOGGLE_TERMINAL_STATION (state, {stationId, tableId}) {
      const table = state.tables.find(t => t.id === tableId)
      if (table.terminalStations.includes(stationId)) {
        table.terminalStations = table.terminalStations.filter(id => id !== stationId)
      } else {
        table.terminalStations.push(stationId)
      }

      const { bank, services } = calculateTableContents(table, state.bank, state.services)
      Vue.set(table, 'bank', bank)
      Vue.set(table, 'services', services)
    },
    TOGGLE_TIME_IGNORE (state, {tableId, serviceIndex, timeIndex}) {
      const table = state.tables.find(t => t.id === tableId)
      const time = table.services[serviceIndex].times[timeIndex]

      Vue.set(time, 'isIgnored', !time.isIgnored)
    },
    RESET_PATTERN_RANGE(state, {tableId}) {
      const table = state.tables.find(t => t.id === tableId)
      Vue.delete(table, 'start')
      Vue.delete(table, 'end')
    },
    SET_PATTERN_RANGE (state, {tableId, start, end}) {
      const table = state.tables.find(t => t.id === tableId)
      if (typeof start === 'number') Vue.set(table, 'start', start)
      if (typeof end === 'number') Vue.set(table, 'end', end)

      // Now calculate pattern matches
      const services = table.services;
      const breadth = table.end - table.start + 1;

      // Reset validity of all times
      services.forEach(service => {
        service.isPatternMatching = false
        service.times.forEach(time => {
          if (time) time.isInvalid = false
        })
      })
      
      if (typeof table.start === 'undefined' || typeof table.end === 'undefined') {
        return
      }

      // Go through each block matching the pattern length and check status
      let patternBroken = false

      for (let groupIndex = table.start + breadth; groupIndex < services.length; groupIndex += breadth) {
        services.slice(groupIndex, groupIndex + breadth).forEach((service, offset) => {
          service.times.forEach((time, timeIndex) => {
            if (time.isIgnored) return;
            const compareTime = services[table.start + offset].times[timeIndex];
            const expectedMinutes = compareTime.isEmpty ? null : compareTime.m

            // Check if the subsequent iterations match the minutes
            if (expectedMinutes !== null) {
              if (time.isEmpty || time.m !== expectedMinutes) {
                patternBroken = true
                time.isInvalid = true
              }
            } else {
              if (!time.isEmpty) {
                patternBroken = true
                time.isInvalid = true
              }
            }
          })
        })

        // If the pattern isn't yet broken, mark all of the services in this
        // group as pattern matching
        services.slice(groupIndex, groupIndex + breadth).forEach(service => {
          service.isPatternMatching = !patternBroken && groupIndex > table.end
        });
      }

      const pmServices = services.filter(service => service.isPatternMatching)
      if (pmServices.length <= breadth * 3) {
        // Don't bother with pattern matching if its impact is only a few hours
        pmServices.forEach(s => s.isPatternMatching = false)
      } else {
        // Cut off the last pattern-matching group because we want to ensure readers have context
        pmServices.slice(-1 * breadth).forEach(s => s.isPatternMatching = false)
      }
    },
  },
})