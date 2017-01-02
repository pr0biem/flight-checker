#!/usr/bin/env node
"use strict"

const Nightmare = require("nightmare")
const chalk = require("chalk")
const rainbow = require("chalk-rainbow")
const twilio = require("twilio")
const blessed = require("blessed")
const contrib = require("blessed-contrib")
const format = require("date-format")
const pretty = require("pretty-ms")
const airports = require("airports")
const nightmare = Nightmare()

const TIME_MS = 1
const TIME_SEC = TIME_MS * 1000
const TIME_MIN = TIME_SEC * 60
const TIME_HOUR = TIME_MIN * 60

// Fares
var prevLowestOutboundFare
var prevLowestInboundFare
const fares = {
  outbound: [],
  inbound: []
}

// Command line options
var originAirport
var destinationAirport
var outboundDateString
var returnDateString
var adultPassengerCount
var individualDealPrice
var totalDealPrice
var interval = 30 // In minutes

// Parse command line options (no validation, sorry!)
process.argv.forEach((arg, i, argv) => {
  switch (arg) {
    case "--from":
    originAirport = argv[i + 1]
    break
    case "--to":
    destinationAirport = argv[i + 1]
    break
    case "--leave-date":
    outboundDateString = argv[i + 1]
    break
    case "--return-date":
    returnDateString = argv[i + 1]
    break
    case "--passengers":
    adultPassengerCount = argv[i + 1]
    break
    case "--individual-deal-price":
    individualDealPrice = parseInt(argv[i + 1])
    break
    case "--total-deal-price":
    totalDealPrice = parseInt(argv[i + 1])
    break
    case "--interval":
    interval = parseFloat(argv[i + 1])
    break
  }
})


class Dashboard {

  constructor() {
    this.markers = []
    this.widgets = {}

    // Configure blessed
    this.screen = blessed.screen({
      title: "Flight Checker",
      autoPadding: true,
      dockBorders: true,
      fullUnicode: true,
      smartCSR: true
    })

    this.screen.key(["escape", "q", "C-c"], (ch, key) => process.exit(0))

    // Grid settings
    this.grid = new contrib.grid({
      screen: this.screen,
      rows: 12,
      cols: 12
    })

    // Graphs
    this.graphs = {
      outbound: {
        title: "Origin/Outbound",
        x: [],
        y: [],
        style: {
          line: "red"
        }
      },
      inbound: {
        title: "Destination/Return",
        x: [],
        y: [],
        style: {
          line: "yellow"
        }
      }
    }

    // Shared settings
    const shared = {
      border: {
        type: "line"
      },
      style: {
        fg: "blue",
        text: "blue",
        border: {
          fg: "green"
        }
      }
    }

    // Widgets
    const widgets = {
      graph: {
        type: contrib.line,
        size: {
          width: 12,
          height: 6,
          top: 0,
          left: 0
        },
        options: Object.assign({}, shared, {
          label: "Prices",
          showLegend: true,
          legend: {
            width: 20
          }
        })
      },
      log: {
        type: contrib.log,
        size: {
          width: 12,
          height: 6,
          top: 6,
          left: 0
        },
        options: Object.assign({}, shared, {
          label: "Log",
          padding: {
            left: 1
          }
        })
      }
    }

    for (let name in widgets) {
      let widget = widgets[name]

      this.widgets[name] = this.grid.set(
        widget.size.top,
        widget.size.left,
        widget.size.height,
        widget.size.width,
        widget.type,
        widget.options
        )
    }
  }

  render() {
    this.screen.render()
  }

  plot(prices) {
    const now = format("MM/dd/yy-hh:mm:ss", new Date())

    Object.assign(this.graphs.outbound, {
      x: [...this.graphs.outbound.x, now],
      y: [...this.graphs.outbound.y, prices.outbound]
    })

    Object.assign(this.graphs.inbound, {
      x: [...this.graphs.inbound.x, now],
      y: [...this.graphs.inbound.y, prices.inbound]
    })

    this.widgets.graph.setData([
      this.graphs.outbound,
      this.graphs.inbound
      ])
  }

  log(messages) {
    const now = format("MM/dd/yy-hh:mm:ss", new Date())
    messages.forEach((m) => this.widgets.log.log(`${now}: ${m}`))
  }

  settings(config) {
    config.forEach((c) => this.widgets.settings.add(c))
  }
}

const dashboard = new Dashboard()

const fetch = () => {
  dashboard.log(['Searching...'])
  nightmare
  .viewport(1920, 1080)
  .goto("http://www.aircanada.com/en/home.html")
  .type('#org1', originAirport)
  .type('#dest1', destinationAirport)
  .type('#departure1', outboundDateString)
  .type('#departure2', returnDateString)
  .select('#numberOfAdults', adultPassengerCount)
  .click('#searchButton')
  .wait('#price_INBOUND')
  .evaluate(() => {
    return {
     outbound: $('#price_OUTBOUND').text(),
     inbound: $('#price_INBOUND').text()
   }
 })
  .then((price) => {
    const lowestInboundFare = parseInt(price.inbound.replace(/\D/g, ''))
    const lowestOutboundFare = parseInt(price.outbound.replace(/\D/g, ''))
    var faresAreValid = true

    const outboundFareDiff = prevLowestOutboundFare - lowestOutboundFare
    const inboundFareDiff = prevLowestInboundFare - lowestInboundFare
    var outboundFareDiffString = ""
    var inboundFareDiffString = ""

    if (!isNaN(outboundFareDiff) && !isNaN(inboundFareDiff)) {
      dashboard.log(['Checking for difference'])

      if ((!isFinite(outboundFareDiff)) || !isFinite(inboundFareDiff)) {
        faresAreValid = false
        dashboard.log(['Fares are invalid.'])
      }

      if (outboundFareDiff > 0) {
        outboundFareDiffString = chalk.green(`(down \$${Math.abs(outboundFareDiff)})`)
      } else if (outboundFareDiff < 0) {
        outboundFareDiffString = chalk.red(`(up \$${Math.abs(outboundFareDiff)})`)
      } else if (outboundFareDiff === 0) {
        outboundFareDiffString = chalk.blue(`(no change)`)
      }

      if (inboundFareDiff > 0) {
        inboundFareDiffString = chalk.green(`(down \$${Math.abs(inboundFareDiff)})`)
      } else if (inboundFareDiff < 0) {
        inboundFareDiffString = chalk.red(`(up \$${Math.abs(inboundFareDiff)})`)
      } else if (inboundFareDiff === 0) {
        inboundFareDiffString = chalk.blue(`(no change)`)
      }
    }

    if (faresAreValid) {
      prevLowestOutboundFare = lowestOutboundFare
      prevLowestInboundFare = lowestInboundFare

      dashboard.log([
        `Lowest fare for an outbound flight is currently \$${[lowestOutboundFare, outboundFareDiffString].filter(i => i).join(" ")}`,
        `Lowest fare for a return flight is currently \$${[lowestInboundFare, inboundFareDiffString].filter(i => i).join(" ")}`
        ])
      dashboard.plot({
        outbound: lowestOutboundFare,
        inbound: lowestInboundFare
      })
      lowestInboundFare
    }
    dashboard.render()
    setTimeout(fetch, interval * TIME_MIN)
  })
}


fetch()