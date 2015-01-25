require('shelljs/global');

var argv = require('yargs').argv;
var assign = require('object-assign');
var buffer = require('vinyl-buffer');
var browserify = require('browserify');
var connect = require('connect');
var cssnext = require('gulp-cssnext');
var del = require('del');
var frontMatter = require('front-matter');
var gulp = require('gulp');
var gulpIf = require('gulp-if');
var gutil = require('gulp-util');
var he = require('he');
var hljs = require('highlight.js');
var htmlmin = require('gulp-htmlmin');
var jshint = require('gulp-jshint');
var nunjucks = require('nunjucks');
var path = require('path');
var plumber = require('gulp-plumber');
var Remarkable = require('remarkable');
var rename = require('gulp-rename');
var serveStatic = require('serve-static');
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var through = require('through2');
var uglify = require('gulp-uglify');


/**
 * The output directory for all the built files.
 */
const DEST = './build';

/**
 * The name of the Github repo.
 */
const REPO = 'solved-by-flexbox';


/**
 * Truthy if NODE_ENV isn't 'dev'
 */
const PROD = process.env.NODE_ENV !== 'dev';


nunjucks.configure('templates', { autoescape: false });


function streamError(err) {
  gutil.beep();
  gutil.log(err instanceof gutil.PluginError ? err.toString() : err.stack);
}


function extractFrontMatter() {
  return through.obj(function (file, enc, cb) {
    try {
      var data = frontMatter(file.contents.toString());
      var content = data.body.trim();
      file.data = data.attributes;
      file.contents = new Buffer(content);
      this.push(file);
    }
    catch (err) {
      this.emit('error', new gutil.PluginError('pages', err, {
        fileName: file.path
      }));
    }
    cb();
  });
}


function renderMarkdown() {
  var markdown = new Remarkable({
    html: true,
    typographer: true,
    highlight: function (code, lang) {
      // Unescape to avoid double escaping.
      code = he.unescape(code);
      return lang ? hljs.highlight(lang, code).value : he.escape(code);
    }
  });
  return through.obj(function (file, enc, cb) {
    try {
      if (path.extname(file.path) == '.md') {
        file.contents = new Buffer(markdown.render(file.contents.toString()));
      }
      this.push(file);
    }
    catch (err) {
      this.emit('error', new gutil.PluginError('pages', err, {
        fileName: file.path
      }));
    }
    cb();
  });
}


function renderTemplate() {
  var globalData =  {
    baseUrl: PROD ? '/' + REPO + '/' : '/',
    env: PROD ? 'prod' : 'dev'
  };
  return through.obj(function (file, enc, cb) {
    try {
      var template = file.data.template;
      var templateData = assign(globalData, file.data);
      var content = file.contents.toString();

      // Render the content with the local data before rendering the template
      // with the full site data.
      templateData.content = nunjucks.renderString(content, templateData);

      file.contents = new Buffer(nunjucks.render(template, templateData));
      this.push(file);
    }
    catch (err) {
      this.emit('error', new gutil.PluginError('pages', err, {
        fileName: file.path
      }));
    }
    cb();
  });
}


gulp.task('pages', ['clean'], function() {
  return gulp.src(['*.html', './demos/**/*'], {base: process.cwd()})
      .pipe(plumber({errorHandler: streamError}))
      .pipe(extractFrontMatter())
      .pipe(renderMarkdown())
      .pipe(renderTemplate())
      .pipe(rename(function(path) {
        if (path.basename != 'index' && path.basename != '404') {
          path.dirname += '/' + path.basename;
          path.basename = 'index';
          path.extname = '.html';
        }
      }))
      .pipe(htmlmin({
        removeComments: true,
        collapseWhitespace: true,
        collapseBooleanAttributes: true,
        removeAttributeQuotes: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        minifyJS: true,
        minifyCSS: true
      }))
      .pipe(gulp.dest(DEST));
});


gulp.task('images', ['clean'], function() {
  return gulp.src('./assets/images/**/*')
      .pipe(gulp.dest(path.join(DEST, 'images')));
});


gulp.task('css', ['clean'], function() {
  return gulp.src('./assets/css/main.css')
      .pipe(plumber({errorHandler: streamError}))
      .pipe(cssnext({compress: true}))
      .pipe(gulp.dest(DEST));
});


gulp.task('lint', function() {
  return gulp.src('./assets/javascript/**/*.js')
      .pipe(plumber({errorHandler: streamError}))
      .pipe(jshint())
      .pipe(jshint.reporter('default'))
      .pipe(gulpIf(PROD, jshint.reporter('fail')))
});


gulp.task('javascript', ['clean', 'lint'], function() {
  return browserify('./assets/javascript/main.js', {debug: true}).bundle()
      .on('error', streamError)
      .pipe(source('main.js'))
      .pipe(buffer())
      .pipe(sourcemaps.init({loadMaps: true}))
      .pipe(gulpIf(PROD, uglify()))
      .pipe(sourcemaps.write('./'))
      .pipe(gulp.dest(DEST));
});


gulp.task('clean', function() {
  del(DEST);
});


gulp.task('default', ['css', 'images', 'javascript', 'pages']);


gulp.task('serve', ['default'], function() {
  var port = argv.port || argv.p || 4000;
  connect().use(serveStatic(DEST)).listen(port);

  gulp.watch('./assets/css/**/*.css', ['css']);
  gulp.watch('./assets/images/*', ['images']);
  gulp.watch('./assets/javascript/*', ['javascript']);
  gulp.watch(['*.html', './demos/*', './templates/*'], ['pages']);
});


gulp.task('release', ['default'], function() {

  // Create a tempory directory and
  // checkout the existing gh-pages branch.
  rm('-rf', '_tmp');
  mkdir('_tmp');
  cd('_tmp');
  exec('git init');
  exec('git remote add origin git@github.com:philipwalton/' + REPO + '.git');
  exec('git pull origin gh-pages');

  // Delete all the existing files and add
  // the new ones from the build directory.
  rm('-rf', './*');
  cp('-rf', path.join('..', DEST, '/'), './');
  exec('git add -A');

  // Commit and push the changes to
  // the gh-pages branch.
  exec('git commit -m "Deploy site."');
  exec('git branch -m gh-pages');
  exec('git push origin gh-pages');

  // Clean up.
  cd('..');
  rm('-rf', '_tmp');
  rm('-rf', DEST);

});
