var express = require('express'),
		MongoClient = require('mongodb').MongoClient,
		ObjectID = require('mongodb').ObjectID,
		BSON = require('mongodb').BSONPure,
		_ = require('underscore'),
		bodyParser = require('body-parser'),
		morgan = require('morgan');
var geoTools = require('geo-tools');
var gm = require('googlemaps');
var GeoJSON = require('geojson');
var util = require('util');
var path = require('path');
var connectionString = "mongodb://localhost:27017/hansolo";
var errorResponse = {error: 'error happened'};

var actionFilter = function(obj) {
	switch(obj.condition) {
		case 'AMBULANCE':
			if(obj.action == "STOP"){
				MongoClient.connect(connectionString, function(err, db){
					var collection = db.collection('users');
					collection.findOne({_id : new ObjectID(obj.user)}, function(err, record){
						if(record && record.balance && record.balance > 0){
							collection.update({_id: new ObjectID(obj.user)}, {$set:{balance : record.balance*2}}, function(err,resp){
								console.log(err, resp);
							});
						}
					});
				});
			}
			break;
	}
};

var app = express();

app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

app.get('/', function(req, res){
		gm.reverseGeocode('12.967262, 77.594368', function(err, data){
			res.json(data);
		});
	});

app.post('/users/charge', function(req, res){
	var obj = _(req.body).pick('user', 'amount');
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('users');
		collection.findOne({_id: ObjectID.createFromHexString(obj.user)}, function(err, record){
			if(err) {
				console.log(err);
				res.json(errorResponse);
			}
			else {
				collection.update({_id : ObjectID.createFromHexString(obj.user)}, {$inc: {balance:obj.amount}}, function(err, resp){
					if(resp == 1) res.json({msg: 'success'});
					else res.json(errorResponse);
					db.close();
				});
			}
		});
	});
});

app.post('/users', function(req, res){
	var obj = _(req.body).pick('name', 'email', 'password');
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('users');
		collection.insert(obj, function(err, resp){
			if(err) resp.json(errorResponse);
			else {
				resp = _(resp[0]).pick('name', 'email', '_id');
				res.jsonp(resp);
				db.close();
			}
		});
	});
});

app.get('/users/:id', function(req, res){
	var id = req.params.id;
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('users');
		collection.findOne({_id: ObjectID.createFromHexString(id)}, function(err, record){
			if(err) {
				console.log(err);
				res.json(errorResponse);
			}
			else {
				record = _(record).omit('password');
				res.json(record);
				db.close();
			}
		});
	});
});

app.post('/actions', function(req, res){
	var obj = _(req.body).pick('user', 'action', 'condition', 'coordinates');
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('actions');
		collection.insert(obj, function(err, resp){
			if(err) res.json(errorResponse);
			else {
				actionFilter(obj);
				res.json({msg : 'success'});
				db.close();
			}
		});
	});
});

app.get('/geojson/:user/:condition', function(req, res){
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('actions');
		collection.find({user:req.params.user, condition:req.params.condition.toUpperCase()}).toArray(function(err, arr){
			if(!err){
				arr = _(arr).map(function(a){
					// gm.reverseGeocode('12.967262, 77.594368', function(err, data){
						return {
							name : req.params.condition,
							category : 'route',
							lat : a.coordinates.location.lat,
							lng : a.coordinates.location.lng
						};
					// });
				});
				GeoJSON.parse(arr, {Point: ['lat', 'lng']}, function(geojson){
					res.jsonp(geojson);
				});
			}
		});
	});
});

app.get('/position/:user', function(req, res){
	var latDelta = 0.008983/1;
	var lngDelta = 0.015060/1;
	var center = {lat: +req.query.lat, lng:+req.query.lng};
	var box = {tl : {lat:center.lat - latDelta, lng: center.lng - lngDelta}, br : {lat:center.lat + latDelta, lng: center.lng + lngDelta}};
	MongoClient.connect(connectionString, function(err, db){
		var collection = db.collection('actions');
		var query = {user:req.params.user, 'coordinates.location.lat':{ $gt: box.tl.lat, $lt: box.br.lat }, 'coordinates.location.lng':{ $gt: box.tl.lng, $lt: box.br.lng }};
		console.log(query);
		collection.find(query).toArray(function(err, arr){
			var filar = _(arr).filter(function(a){
				if(toMeters(distance(center, a.coordinates.location))<200){
					return true;
				} else {
					return false;
				}
			});
			if(filar.length > 0) res.jsonp({code : 1, msg: 'Potholes in vicinity(less than 200m)'});
			else res.jsonp({code : 0, msg: 'no potholes in near vicinity'});
		});
	});
})

var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port);
});