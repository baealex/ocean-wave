import models, { type SmartView } from '~/models';

import { smartViewFieldResolvers } from './smart-view.field.resolver';

describe('smart view field resolvers', () => {
    beforeEach(async () => {
        await models.smartViewTag.deleteMany();
        await models.smartView.deleteMany();
        await models.musicTag.deleteMany();
        await models.tag.deleteMany();
    });

    it('resolves view tags and tag ids in stored order', async () => {
        const firstTag = await models.tag.create({
            data: {
                name: 'Dreamy',
                normalizedName: 'dreamy'
            }
        });
        const secondTag = await models.tag.create({
            data: {
                name: 'Night',
                normalizedName: 'night'
            }
        });
        const view = await models.smartView.create({
            data: {
                name: 'Night Drive',
                normalizedName: 'night drive',
                SmartViewTag: {
                    createMany: {
                        data: [{
                            tagId: firstTag.id,
                            order: 0
                        }, {
                            tagId: secondTag.id,
                            order: 1
                        }]
                    }
                }
            }
        });

        const resolvers = smartViewFieldResolvers as {
            tags: (view: SmartView) => Promise<Array<{ id: number }>>;
            tagIds: (view: SmartView) => Promise<string[]>;
        };

        await expect(resolvers.tags(view)).resolves.toEqual([
            expect.objectContaining({ id: firstTag.id }),
            expect.objectContaining({ id: secondTag.id })
        ]);
        await expect(resolvers.tagIds(view)).resolves.toEqual([
            firstTag.id.toString(),
            secondTag.id.toString()
        ]);
    });
});
