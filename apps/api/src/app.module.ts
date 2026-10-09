import { Module } from '@nestjs/common';
import { AuthController } from './auth';
import { BookingModule } from './booking/module';
import { CatalogController, OwnerController } from './catalog';
import { CommunityController, AdminController } from './community';
import { MediaController } from './media';
import { MapsController } from './maps';
import { DocumentController } from './documents/controller';
import { NewsletterController, NewsletterAdminController } from './newsletter/controller';
@Module({
  imports: [BookingModule],
  controllers: [
    AuthController,
    CatalogController,
    OwnerController,
    CommunityController,
    AdminController,
    MediaController,
    MapsController,
    DocumentController,
    NewsletterController,
    NewsletterAdminController,
  ],
})
export class AppModule {}
