/**
 * Main application controller
 * @author mrcaps
 */

var sys = require("sys"),
    express = require("express"),
    formidable = require("formidable"),
    log = require("./public/js/log.js").getLogger(0),
    fs = require("fs"),
    db = require("./db.js");
    
db.ensureSetup();
     
var app = express.createServer();
app.use(app.router);
app.use(express.static(__dirname + "/public"));

app.configure(function() {
    app.set("views", __dirname + "/tmpl");
});

app.get("/", function(req, res) {
    res.render("index.ejs", {pageTitle: "home"});
});

/**
 * Render timeseries upload page
 */
app.get("/send", function(req, res) {
   res.render("upload.ejs", {pageTitle: "upload"});
});

app.get("/foo", function(req, res) {
   res.end("HI!!!!"); 
});

var FDIR = "files";

/**
 * allocate a new id and space for a file
 * @param next continuation(allocname)
 */
var allocfile = function(filename, next) {
    db.connect(function(conn) {
        db.grabid(conn, function(newid) {

        });
    });
}

//our desired middleware
var presnagid_async = function(req, res, next) {
    req.pause();
    db.connect(function(conn) {
        db.grabid(conn, function(newid) {
            req.newid = newid;
            conn.close();
            next();
        });
    });
}

var idqueue = [];
var queueid = function(next) {
    db.connect(function(conn) {
        db.grabid(conn, function(newid) {
            idqueue.push(newid);
            conn.close();
            next(newid);
        })
    });
}

//queue a couple IDs to begin
queueid(function(id1) {
    queueid(function(id2) {
        queueid(function(id3) {
            log(0, "Done queueing initial ID buffer -> " + id3);
        });
    });
})

//queue up some IDs to make synchronous possible
var presnagid_sync = function(req, res, next) {
    req.newid = idqueue.shift();
    queueid(function(id) {
        log(0, "Queued new id " + id);
    });
    next();
}

//grr... async seam in request isn't possible without an extra workaround
//  http://groups.google.com/group/nodejs/browse_thread/thread/cafe8397e3bec189/72a2f91c638aa094
//  http://groups.google.com/group/nodejs/browse_thread/thread/6e7bc2508abd1717

app.post("/upload", presnagid_sync, function(req, res) {
    var form = new formidable.IncomingForm();
    log(0, "Incoming request");
    
    var obtained = 0;
    form.onPart = function(part) {
        log(0, "Got form part");
        filename = req.newid;
        
        var ws = fs.createWriteStream(hashname(filename), {
            flags: "w",
            encoding: null,
            mode: 0666
        });
        ws.addListener("drain", function() {
            req.resume();
        });
        
        //update writing progress on lock
        var updater = setInterval(function() {
            setlock(filename, ws.bytesWritten);
        }, 4000);
        
        part.addListener("data", function(chunk) {
            log(0, "Rcv chunk len=" + chunk.length);
            obtained += chunk.length;
            
            var flushed = ws.write(chunk);
            if (!flushed) {
                req.pause();
            }
        });
        part.addListener("end", function() {
            log(0, "Finished stream; total now " + obtained);

            clearInterval(updater);

            req.resume();
            ws.end();
            remlock(filename);
            
            var restxt = JSON.stringify([{
               name: filename,
               size: obtained,
               url: filename
            }]);
            res.end(restxt);
        });
        
        //this must all be synchronous!
        //add the new location, but don't wait for callback
        db.connect(function(conn) {
            db.setfileprop(conn, req.newid, "name", filename, function() {
                conn.close();
            });
        });
        setlock(filename, 0);
    };
    
    //we must begin parsing immediately.
    form.parse(req);
});

function hashname(filename) {
    return FDIR + "/" + filename;
}
function lockname(filename) {
    return hashname(filename) + ".lock";
}

function setlock(filename, written) {
    fs.writeFileSync(
        lockname(filename),
        JSON.stringify({available: written}),
        "utf8");
}
function remlock(filename) {
    fs.unlinkSync(lockname(filename));
}
function getlock(filename) {
    try {
        var fcont = fs.readFileSync(lockname(filename), "utf8");
        try {
            return JSON.parse(fcont);
        } catch (err) {
            log(0, "Couldn't parse lock!: " + fcont);
        }
    } catch (err) {
        return null;
    }
}

var MAX_AVAILABLE = Number.MAX_VALUE - 1;

//download files
app.get("/:name", function(req, res) {
    var pname = req.params.name;
    log(0, "recv request for " + pname);
    var targetname = hashname(pname);
    fs.stat(targetname, function(err, stats) {
        if (err) {
            res.end(JSON.stringify(err));
            return;
        }
        
        var available = 0;
        var obtained = 0;
        
        var bufsize = 64*1024;
        var readopts = {
            flags: "r",
            encoding: null,
            mode: 0666,
            bufferSize: bufsize
        };
        var rs = fs.createReadStream(targetname, readopts);

        var checker = null;
        //check to see if enough has been written to resume download
        var checkfn = function() {
            var lock = getlock(pname);
            if (!lock) {
                available = MAX_AVAILABLE;
                rs.resume();
                if (null !== checker) {
                    clearInterval(checker);
                }
                return;
            }
            if (lock.available - obtained > 2*bufsize) {
                available = lock.available;
                rs.resume();
            }
        };
        //if we're currently uploading, start watching for updates
        if (available != MAX_AVAILABLE) {
            rs.pause();
            checkfn();
            checker = setInterval(checkfn, 1000);
        }

        rs.addListener('data', function(chunk) {
            obtained += chunk.length;
            res.write(chunk);
            if (available - obtained < 2*bufsize) {
                rs.pause();
            }
        });
        rs.addListener('end', function() {
            //early termination...
            log(0, "End @ " + obtained);
            res.end();
        });
    });
});

var myport = process.env.VMC_APP_PORT || 3000;
app.listen(myport);
log(0, "Server running on port " + myport);