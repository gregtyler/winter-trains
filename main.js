/* globals Vue, store, JSZip */
// Convert raw time to time object
function rawToTime(raw) {
  // 1 - Preceding bracket to indicate a connection time
  // 2 - Hours in the time
  // 3 - Minutes in the time
  // 4 - Any footnotes
  const match = raw.match(/(\(?)([0-9]{1,2})[:.]?([0-9]{0,2})([a-z ]*)/)

  if (match) {
    const hours = match[2].padStart(2, '0')
    const minutes = match[3].padStart(2, '0')
    
    return {
      isEmpty: false,
      isConnection: match[1] === '(',
      h: parseInt(hours, 10),
      m: parseInt(minutes, 10),
      vis: `${hours}:${minutes}${match[4]}`,
      output: `${hours}${minutes}${match[4] ? `<CharStyle:TimeFootnote>${match[4]}<CharStyle:None>` : ''}`,
    }
  } else {
    return {
      isEmpty: true,
      h: null,
      m: null,
      vis: '    ',
      output: '',
    };
  }
}

// Get data
async function getData(fileContents) {
  const bank = []
  const services = []
  
  // Remove weird formatting issues
  if (fileContents.substr(0, 3) === 'ï»¿') {
    fileContents = fileContents.substr(3)
  }
  
  // Remove trailing whitespace
  fileContents = fileContents.trim()

  // Convert CSV into objects
  fileContents.split(/[\n\r]+/).forEach((row, rowIndex) => {
    // Skip empty rows
    if (row.replace(/,/g, '') === '') return
    
    const [name, type, ...times] = row.split(',')

    bank.push({
      id: rowIndex,
      name,
      type,
    })

    times.forEach((rawTime, serviceIndex) => {
      const time = rawToTime(rawTime)

      if (rowIndex === 0) {
        services.push({times: [time]})
      } else {
        services[serviceIndex].times.push(time)
      }
    })
  })

  // Validate contents
  const invalidService = services.find(service => service.times.length !== bank.length);
  if (invalidService) {
    const stopIndex = invalidService.times.findIndex(x => x.vis !== '')
    throw new Error(`Error parsing CSV: ${invalidService.times[stopIndex].vis} service from ${bank[stopIndex].name} has invalid number of stops.`);
  }

  return {
    bank,
    services,
  }
}

Vue.component('sub-table', {
  template: '#sub-table',
  props: ['id'],
  computed: {
    allStations() {
      return this.$store.state.bank
    },
    table() {
      return this.$store.state.tables.find(table => table.id === this.id)
    },
  },
  methods: {
    resetRange() {
      this.$store.commit('RESET_PATTERN_RANGE', {tableId: this.id})
      this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id})
    },
    setStart(index) {
      this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id, start: index, end: index})
    },
    setEnd(index) {
      if (index > this.table.start) {
        this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id, end: index})
      } else if (index < this.table.start) {
        this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id, start: index})
      }
    },
    toggleTerminalStation(stationId) {
      this.$store.commit('TOGGLE_TERMINAL_STATION', {tableId: this.id, stationId})
      // Force patterns to regenerate
      this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id})
    },
    toggleTimeIgnore(serviceIndex, timeIndex) {
      this.$store.commit('TOGGLE_TIME_IGNORE', {tableId: this.id, serviceIndex, timeIndex})
      // Force patterns to regenerate
      this.$store.commit('SET_PATTERN_RANGE', {tableId: this.id})
    },
  }
})

Vue.component('download-button', {
  template: '#download-button',
  props: ['tables', 'filename'],
  methods: {
    renderService(service) {
      return service.times
        .map(time => {
          if (time.isEmpty) {
            return '<ParaStyle:EmptyTime><0x2022>' 
          } else {
            return `<ParaStyle:${time.isConnection ? 'ConnectorFeeder' : 'Time'}>${time.output}`
          }
        })
        .join('\n');
    },
    download() {
      const zip = new JSZip()
      
      const files = this.tables.map((table) => {
        const columns = []

        // Add a column for the station bank
        const bankRenders = table.bank.map((station, index) => {
          let stationStyle = 'Station'
          if (index === 0) stationStyle = 'StationtintMonFri'
          if (index === table.bank.length - 1) stationStyle = table.bank.length === 2 ? 'StationUnderline' : 'StationtintUnderlineMonFri'
          return `<ParaStyle:${stationStyle}>${station.name}\t${station.type}`
        })
        
        columns.push('<ParaStyle:StationUnderline>\n' + bankRenders.join('\n'))

        if (typeof table.start === 'number' && typeof table.end === 'number') {
          // Add the times before the pattern
          columns.push(...table.services.slice(0, table.end + 1).map(this.renderService))
          // Insert two blank columns
          columns.push('<cNextXChars:>')
          columns.push('<cNextXChars:>')
    
          // We don't output the pattern, instead it's layered with an graphic saying "then the same time every hour until"
          // However, I've left the code for future reference
          // columns.push(...table.services.slice(table.start, table.end + 1).map(service => {
          //   return service.times
          //     .map(time => time.isEmpty ? '<ParaStyle:EmptyTime><0x2022>' : `<ParaStyle:Time>xx:${time.m}`)
          //     .join('\n');
          // }))
    
          // Add the services after the pattern
          const firstOutOfPattern = table.services.slice(table.end + 1).find(service => !service.isPatternMatching)
          const firstOutIndex = table.services.indexOf(firstOutOfPattern)
          columns.push(...table.services.slice(firstOutIndex).map(this.renderService))
        } else {
          // If there's no pattern, just add every service in order
          columns.push(...table.services.map(this.renderService))
        }
        
        return {
          name: `${this.filename} (${table.name}).txt`,
          content: `<ASCII-MAC>\n<Version:13.1>\n${columns.join('<cNextXChars:Column>\n')}`,
        }
      })
        
      const downloadTrigger = document.createElement('a')
      
      if (files.length === 1) {
        // For one file, download it immediately
        const blob = new Blob([files[0].content], { type: 'text/plain' })
        downloadTrigger.href = URL.createObjectURL(blob)
        downloadTrigger.download = files[0].name
        document.body.appendChild(downloadTrigger)
        downloadTrigger.click()
        document.body.removeChild(downloadTrigger)
      } else {
        // Download multiple files in a ZIP
        files.forEach(file => {
          zip.file(file.name, file.content)
        })
        
        zip
          .generateAsync({type: 'blob'})
          .then((content) => {
            downloadTrigger.href = URL.createObjectURL(content)
            downloadTrigger.download = `${this.filename}.zip`
            document.body.appendChild(downloadTrigger)
            downloadTrigger.click()
            document.body.removeChild(downloadTrigger)
          })
      }
    }
  }
})

Vue.component('select-tables', {
  template: '#select-tables',
  props: ['bank'],
  data: () => ({
    selected: [],
  }),
  methods: {
    saveTables() {
      const selectedStations = this.selected.map(stationId => this.bank.find(station => station.id === stationId))
      
      this.tables = selectedStations.forEach(station => {
        let name
        // If there are multiple tables for the same station, include the station type
        if (selectedStations.filter(x => x.name === station.name).length > 1) {
          name = `${station.name} - ${station.type}`
        } else {
          name = station.name
        }
        
        this.$store.commit('ADD_TABLE', {name, type: station.type, target: station.id})
      })
    },
    toggleSelected(stationId) {
      if (this.selected.includes(stationId)) {
        this.selected.splice(this.selected.indexOf(stationId), 1)
      } else {
        this.selected.push(stationId)
      }
    },
  }
})

new Vue({
  el: '#app',
  store,
  computed: {
    bank() {
      return this.$store.state.bank
    },
    tables() {
      return this.$store.state.tables
    }
  },
  data: () => ({
    filename: '',
    error: null,
  }),
  methods: {
    restart() {
      window.location.reload()
    },
    upload(event) {
      const reader = new FileReader()
      this.error = null

      reader.onload = async (event) => {
        try {
          const data = await getData(event.target.result)

          this.$store.commit('LOAD_BANK', data.bank)
          this.$store.commit('LOAD_SERVICES', data.services)
        } catch (e) {
          this.error = e
        }
      }

      this.filename = event.target.files[0].name.split('.').slice(0, -1).join('.')
      reader.readAsBinaryString(event.target.files[0])
    }
  }
})