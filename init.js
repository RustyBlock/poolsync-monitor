var express = require('express')
  , logger = require('morgan')
  , fs = require('fs')
  , app = express()
  , template = require('pug').compileFile(__dirname + '/templates/index.pug')
  , poolRatings = {
        data: {
            x: 'x',
            columns: [
                ['x']
            ]
        },
        axis: {
            x: {
                type: 'timeseries',
                tick: {
                    format: '%H:%M:%S'
                }
            },
            y: {
                max: 100,
                min: 0,
                tick: {
                    format: function (d) { return d + '%'; }
                }
            }
        },
        point: {
            show: false
        }
    }
  , cfg = JSON.parse(fs.readFileSync(__dirname + '/pools.json'))
  , request = require('request')
  , zlib = require('zlib')
  , MemoryStream = require('memorystream')
  , headers = {
    "accept-charset" : "ISO-8859-1,utf-8;q=0.7,*;q=0.3",
    "accept-language" : "en-US,en;q=0.8",
    "accept" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "user-agent" : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/537.13+ (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2",
    "accept-encoding" : "gzip,deflate"};

app.use(logger('dev'));
app.use(express.static(__dirname + '/static'));
app.use(express.static(__dirname + '/node_modules'));

app.get('/', function (req, res, next) {
    try {
        var html = template({ title: 'Daemon status', 
            subTitle: 'RustyBlock daemon monitor', 
            data: JSON.stringify(poolRatings),
            interval: cfg.interval,
         })
        res.send(html)
    } catch (e) {
        next(e)
    }
});
  
app.listen(process.env.PORT || 3000, function () {
    console.log('Listening on http://localhost:' + (process.env.PORT || 3000))
});

// initialize chart lines with pool titles
cfg.pools.forEach(function(pool) {
    poolRatings.data.columns.push([pool.title]);
});

function collectStats() {
    
    var counter = 0, 
        heights = []; // prepare to load height information from each pool 

    cfg.pools.forEach(function(pool) {
        var poolitm = pool,
            stream = new MemoryStream(),
            data = '';

        stream.on('data', function(chunk){
            data += chunk;
            console.debug("Data received from", poolitm.url);
        });
        
        stream.on('end', function(){
            var height;

            console.debug("Extracting data from", poolitm['url-type'], "url:", poolitm.url); 
            if(poolitm['url-type'] === 'json') {
                height = extractHeightFromJson(data, poolitm);
            } else {
                height = extractHeightFromHtml(data, poolitm);
            }
            if(height > 0) {
                console.info(poolitm.url, "is at", height);
                heights.push({ title: poolitm.title, height: height});
            }      

            processHeights(++counter, heights);
        });
        
        function processHeights(cntr, hghts)
        {
            var swapped = false,
                n = hghts.length;

            if(cntr < cfg.pools.length) {
                return;
            }
                    
            // order by height descending
            do {
                swapped = false;
                for(var i=1; i <= n-1; i++) {
                    if(hghts[i-1].height < hghts[i].height) {
                        var tmp = hghts[i-1];
                        hghts[i-1] = hghts[i];
                        hghts[i] = tmp;
                        swapped = true;
                    }
                }
                n--;
            } while(swapped);

            hghts[0].rating = 100; // biggest height is 100% rating
            for(var i=1; i < hghts.length; i++) {
                var diff = hghts[i-1].height - hghts[i].height;
                if(diff > 4) {
                    hghts[i].rating = 0; // smallest rating is 0%
                } else {
                    if(hghts[i-1].rating === 0) {
                        hghts[i].rating = 0;
                    } else {
                        hghts[i].rating = hghts[i-1].rating - diff * 25; // minus 25% for each block difference 
                    }
                }
            }

            // save time for the current tick
            poolRatings.data.columns[0].push((new Date()).getTime());

            hghts.forEach(function(itm) {
                poolRatings.data.columns.some(function(col) {
                    if(col[0] === itm.title) {
                        col.push(itm.rating);
                        if(col.length > 720) { // 3 hours
                            col.splice(1, col.length - 720);
                        }
                        return true;
                    }
                    return false;
                });
            });

            setTimeout(collectStats, cfg.interval * 1000);
        }

        console.info("Polling ", pool.url);
        compressedRequest({
            rejectUnauthorized: false,
            url: pool.url,
            headers: headers            
        }, stream, function(error) {
            console.error('[', poolitm.url, '] Failed to fetch stats:', error);
            processHeights(++counter, heights);
        });
    });
}

collectStats();

function extractHeightFromJson(text, pool) {
    var stats = JSON.parse(text),
        height = stats;

    pool['path-to-height'].forEach(function(field) {
        height = height[field];
        if (typeof height === 'undefined') {
            console.error('[', pool.url, '] Incorrect path to height field: ', pool['path-to-height']);
            return 0;
        }
    });

    return height;
}

function extractHeightFromHtml(text, pool) {
    var blockIdx = text.indexOf(pool['path-to-height']);
    if(blockIdx === -1) {
        console.error('[', pool.url, '] Incorrect path to height field: ', pool['path-to-height']);
        return 0;
    }
    return Number.parseInt(text.substring(
        blockIdx + pool['path-to-height'].length,
        text.indexOf('"', blockIdx + pool['path-to-height'].indexOf('"') + 1)
    ), 10);
}

function compressedRequest (options, outStream, callback) {
    var req = request(options), callback = callback || function(){};
  
    req.on('response', function (res) {
      if (res.statusCode !== 200) {
          callback(new Error('Status not 200'));
          return;
      }
  
      var encoding = res.headers['content-encoding']
      if (encoding == 'gzip') {
        res.pipe(zlib.createGunzip()).pipe(outStream)
      } else if (encoding == 'deflate') {
        res.pipe(zlib.createInflateRaw()).pipe(outStream)
      } else {
        res.pipe(outStream)
      }
    })
  
    req.on('error', function(err) {
      callback(err);
    })
  }