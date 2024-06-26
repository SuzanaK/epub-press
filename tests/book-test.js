'use strict';

const Sinon = require('sinon');
const TestHelpers = require('./helpers');

const Book = require('../lib/book');
const Utilities = require('../lib/utilities');
const { VALID_BOOK_METADATA_KEYS } = require('../lib/constants');

const bookMetadata = {
    title: 'Test Book',
    urls: ['http://www.a.ca', 'http://www.b.ca', 'http://www.c.ca'],
};

let book;
const title = 'Section';
const content = '<p>Some Content</p>';
const url = 'http://www.a.com/';

describe('Book', () => {
    beforeAll(() => {
        book = new Book(bookMetadata);
    });

    describe('constructor', () => {
        it('sanitizes the title', () => {
            const specialBook = new Book({ title: "Book with ' in the title" });
            expect(specialBook.getTitle()).toContain('&#39;');
        });

        it('uses the current date in the title', () => {
            const untitledBook = new Book();
            expect(untitledBook.getTitle()).toContain(Date().slice(0, 9));
        });

        it('can be constructed with sections', () => {
            const section = { url: 'http://google.com', html: '<html></html>' };
            const sectionBook = new Book(bookMetadata, [section]);

            const sections = sectionBook.getSections();

            expect(sections.length).toBe(1);
            expect(sections[0].url).toEqual('http://google.com');
            expect(sections[0].html).toEqual('<html></html>');
        });

        it('accepts cover path with http', () => {
            const metadata = { coverPath: 'http://localhost', ...bookMetadata };
            const bookWithCover = new Book(metadata);
            expect(bookWithCover.getCoverPath()).toEqual('http://localhost');
        });

        it('accepts cover path with https', () => {
            const metadata = { coverPath: 'https://localhost', ...bookMetadata };
            const bookWithCover = new Book(metadata);
            expect(bookWithCover.getCoverPath()).toEqual('https://localhost');
        });

        it('rejects cover path that is not http(s)', () => {
            const metadata = { coverPath: '/etc/passwd', ...bookMetadata };
            const act = () => {
                // eslint-disable-next-line
                new Book(metadata);
            };
            expect(act).toThrow('coverPath must be http or https');
        });
    });

    describe('#getId', () => {
        it('returns an id', () => {
            expect(typeof book.getId()).toBe('string');
        });
    });

    describe('#getTitle', () => {
        it('returns titles passed to the book', () => {
            expect(book.getTitle()).toEqual(bookMetadata.title);
        });
    });

    describe('#addSection', () => {
        it('can add sections', () => {
            book.addSection({ title: 'Section 1', content });
            book.addSection({ title: 'Section 2', content });

            const sections = book.getSections();

            expect(sections[sections.length - 1].title).toEqual('Section 2');
            expect(sections[sections.length - 1].content).toEqual(content);
        });
    });

    describe('#getReferences', () => {
        it('returns a reference page containing all sections', () => {
            book = new Book(bookMetadata, [
                { title: 'Titled', url: 'http://google.com' },
                { url: 'http://yahoo.com' },
            ]);

            const referencesHtml = book.getReferences();

            book.getSections().forEach((section) => {
                expect(referencesHtml).toContain(section.title);
                expect(referencesHtml).toContain(section.url);
            });
        });
    });

    describe('#hasDefaultCover', () => {
        it('returns false if a non-default cover is present', () => {
            book = new Book({ coverPath: 'https://custome.img' });

            expect(book.hasDefaultCover()).toBe(false);
        });

        it('returns true if the book is using the default cover', () => {
            book = new Book();

            expect(book.hasDefaultCover()).toBe(true);
        });
    });

    describe('#deleteAssets', () => {
        it('deletes files returned by #getAssets', () => {
            Sinon.stub(Utilities, 'removeFiles').resolves([]);

            const assets = book.getAssets();
            return book.deleteAssets().then((b) => {
                const removeFilesCall = Utilities.removeFiles.getCall(0);
                Utilities.removeFiles.restore();
                expect(removeFilesCall.args[0]).toEqual(assets);
                expect(b.getMetadata().images.length).toBe(0);
                expect(b.getCoverPath()).toEqual(Book.DEFAULT_COVER_PATH);
            });
        });
    });

    describe('#deleteFiles', () => {
        it('deletes ebook files', () =>
            book
                .writeEpub()
                .then(() => book.deleteFiles())
                .then(() => {
                    TestHelpers.assertNoFile(book.getEpubPath());
                    TestHelpers.assertNoFile(book.getMobiPath());
                }));
    });

    describe('#writeEpub', () => {
        it('saves an epub file', () => {
            const EpubWriter = {
                writeEPUB: Sinon.spy((onErr, p, f, onSuccess) => {
                    onSuccess();
                }),
                addSection: Sinon.spy(),
                addCSS: Sinon.spy(),
            };
            const getEPUBWriterStub = Sinon.stub(Book, 'getEpubWriter').returns(EpubWriter);

            book.getSections().forEach((section) => {
                const updatedSection = section;
                updatedSection.title = 'Title';
                updatedSection.xhtml = '<div></div>';
            });

            return book.writeEpub().then(() => {
                expect(EpubWriter.addSection.callCount).toEqual(book.getSections().length + 1);
                expect(EpubWriter.writeEPUB.callCount).toEqual(1);
                expect(EpubWriter.addCSS.callCount).toEqual(1);

                getEPUBWriterStub.restore();
            });
        });
    });

    describe('.isValidSection', () => {
        it('can validate sections', () => {
            expect(Book.isValidSection({ title, content })).toBe(true);
            expect(Book.isValidSection({ url })).toBe(true);

            expect(Book.isValidSection({ title })).toBe(false);
            expect(Book.isValidSection({ content })).toBe(false);
        });
    });

    describe('.fromJSON', () => {
        const reqBody = {
            title: 'A book',
            description: 'A description',
            urls: ['url1', 'url2'],
            author: 'Tom Riddle',
        };

        it('builds books from request objects', () => {
            const objBook = Book.fromJSON(reqBody);
            expect(objBook.getSections().length).toBe(2);
            const jsonBook = Book.fromJSON(JSON.stringify(reqBody));
            expect(jsonBook.getSections().length).toBe(2);
        });

        it('converts urls to sections', () => {
            const jsonBook = Book.fromJSON(reqBody);

            jsonBook.getSections().forEach((section) => {
                expect(typeof section).toBe('object');
                expect(section.html).toBeNull();
            });
        });

        it('accepts valid metadata', () => {
            const coverPath = 'https://via.placeholder.com/816x1056.jpg?text=Cover';
            const tags = 'One, Two, Three';
            const reqBodyClone = { coverPath, tags, ...reqBody };
            const jsonBook = Book.fromJSON(reqBodyClone);
            const metadata = jsonBook.getMetadata();

            VALID_BOOK_METADATA_KEYS.forEach((key) => {
                if (reqBodyClone[key]) {
                    expect(metadata[key]).toEqual(reqBodyClone[key]);
                }
            });

            expect(jsonBook.getCoverPath()).toEqual(coverPath);
            expect(jsonBook.getTags()).toEqual(tags);
        });

        it('throws invalid property error', () => {
            const reqBodyWithInvalidProperty = { 'bad-property': 'bad-value', ...reqBody };
            const act = () => {
                Book.fromJSON(reqBodyWithInvalidProperty);
            };

            expect(act).toThrow("invalid property 'bad-property'");
        });
    });

    describe('.sanitizeTitle', () => {
        it('cleans potential titles', () => {
            const generatedTitle = Book.sanitizeTitle('  Title \n');
            expect(generatedTitle).toEqual('Title');
        });
    });
});
